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
  appSignInCell,
  firstPassword,
  givePayload,
  hasMobile,
  isSharedNumber,
  newGiveIntent,
  passwordPayload,
  stopPayload,
  toldWords,
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

  it('knows the refusal of a number whose sign-in another business made, and nothing else as it (R1)', () => {
    expect(isSharedNumber({ status: 409, data: { code: 'number_has_sign_in' } })).toBe(true)
    expect(isSharedNumber({ status: 400, data: { code: 'mobile_needed' } })).toBe(false)
    expect(isSharedNumber({ status: 409, message: 'This shop is switched off.' })).toBe(false)
    expect(isSharedNumber(null)).toBe(false)
  })

  it('says the shopkeeper uses their own password only where that is true (R4)', () => {
    expect(toldWords('already', false)).toBe('si.already')
    expect(toldWords('existing', true)).toBe('si.existingOwn')
    expect(toldWords('existing', false)).toBe('si.existingFirst')
    expect(SHOP_SIGN_IN_STRINGS['si.existingOwn']).toContain('uses their own password')
    expect(SHOP_SIGN_IN_STRINGS['si.existingFirst']).not.toContain('uses their own password')
    expect(SHOP_SIGN_IN_STRINGS['si.shared']).toContain('Use another mobile number')
    expect(SHOP_SIGN_IN_STRINGS['si.sharedTyped']).toContain('Enter another mobile number')
  })

  it('says what the register cell is where a phone row has no head, and stays terse under the desk head', () => {
    const t = (key: 'si.rowAs' | 'si.rowNone' | 'si.noneShort', params?: { username: string }) =>
      SHOP_SIGN_IN_STRINGS[key].replace('{username}', params?.username ?? '')
    const signIn = { username: 'ramesh.gupta', since: '2026-09-29T08:00:00.000Z' }
    expect(appSignInCell(t, signIn, false)).toBe('ramesh.gupta')
    expect(appSignInCell(t, null, false)).toBe('Not yet')
    expect(appSignInCell(t, signIn, true)).toBe('App: ramesh.gupta')
    expect(appSignInCell(t, null, true)).toBe('No app sign-in yet')
  })

  it('never names membership, identity, tenant, link or role on the screen', () => {
    for (const [keyName, text] of Object.entries(SHOP_SIGN_IN_STRINGS)) {
      expect(text, keyName).not.toMatch(/\b(membership|identity|tenant|link|role)s?\b/i)
    }
  })
})
