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
  afterSharedNumber,
  appSignInCell,
  firstPassword,
  givePayload,
  handOverSentence,
  hasMobile,
  isSharedNumber,
  newGiveIntent,
  passwordPayload,
  SHOWN_ONCE_BUTTONS,
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
    expect(SHOP_SIGN_IN_STRINGS['si.sharedTyped']).toContain('Enter another mobile number')
  })

  it('asks for another mobile right in the dialog when the number has a sign-in elsewhere, and never sends the desk to a screen it lacks (R1, DOS-428)', () => {
    // the shop's own number: named in the sentence, the field starts empty
    expect(afterSharedNumber(false, '')).toEqual({ mobile: '', problem: 'si.shared' })
    expect(SHOP_SIGN_IN_STRINGS['si.shared']).toContain('{phone}')
    // a number the desk typed: it stays in the field, so the desk sees what was refused
    expect(afterSharedNumber(true, '98765 43210')).toEqual({
      mobile: '98765 43210',
      problem: 'si.sharedTyped',
    })
    for (const key of ['si.shared', 'si.sharedTyped'] as const) {
      expect(SHOP_SIGN_IN_STRINGS[key]).toContain('Enter another mobile number of the shopkeeper')
      expect(SHOP_SIGN_IN_STRINGS[key]).not.toMatch(/change it on the shop/i)
    }
    expect(SHOP_SIGN_IN_STRINGS['si.mobileReplaceHelp']).toContain('saved as the shop’s mobile')
    // the typed mobile goes in the request, which the contract takes for a shop that has one too
    const payload = givePayload(shopId, newGiveIntent('+919812345678'), key)
    expect(GiveShopSignInInput.safeParse(payload).success).toBe(true)
    expect(payload.phone).toBe('+919812345678')
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

  it('says one sentence under the shown password, for what this device can do, and has one closing button', () => {
    expect(handOverSentence(true, true)).toBe('si.shownOnce')
    expect(handOverSentence(true, false)).toBe('si.shownOnceCopy')
    expect(handOverSentence(false, true)).toBe('si.shownOnceShare')
    expect(handOverSentence(false, false)).toBe('si.shownOnceRead')
    const said = (canCopy: boolean, canShare: boolean) =>
      SHOP_SIGN_IN_STRINGS[handOverSentence(canCopy, canShare)]
    // never a button the dialog does not show
    expect(said(true, false)).not.toMatch(/share/i)
    expect(said(false, true)).not.toMatch(/copy/i)
    expect(said(false, false)).not.toMatch(/\b(copy|share) it (or|with)\b/i)
    expect(said(false, false)).toContain('cannot copy or share')
    for (const [canCopy, canShare] of [
      [true, true],
      [true, false],
      [false, true],
      [false, false],
    ] as const) {
      const sentence = said(canCopy, canShare)
      expect(sentence.startsWith('This password is shown only now')).toBe(true)
      // the old pair contradicted itself: "no share sheet" beside "Copy it or share it"
      expect(sentence).not.toMatch(/share sheet/i)
    }
    // the sentences the dialog printed two at a time are gone
    expect(Object.keys(SHOP_SIGN_IN_STRINGS)).not.toContain('si.noShareSheet')
    expect(Object.keys(SHOP_SIGN_IN_STRINGS)).not.toContain('si.nothingToCopy')
    // one closing button, the one that says what the desk did
    expect(SHOWN_ONCE_BUTTONS).toEqual({ confirm: 'si.done', cancel: null })
  })

  it('says what is true of a phone already signed in when the desk gives a new first password (DOS-426)', () => {
    const body = SHOP_SIGN_IN_STRINGS['si.newPasswordBody']
    expect(body).not.toMatch(/signed out of the app on every phone/i)
    expect(body).toContain('A phone already signed in keeps working for up to 15 minutes')
    expect(body).toContain('must choose a new password')
  })

  it('says what is true of both kinds of login when the desk stops a sign-in (DOS-425)', () => {
    const body = SHOP_SIGN_IN_STRINGS['si.stopBody']
    expect(body).not.toMatch(/You can give it a sign-in again later\.$/)
    expect(body).toContain('you may be asked for another mobile number of the shopkeeper')
    expect(body).toContain('Its orders, bills and dues stay as they are')
  })

  it('never names membership, identity, tenant, link or role on the screen', () => {
    for (const [keyName, text] of Object.entries(SHOP_SIGN_IN_STRINGS)) {
      expect(text, keyName).not.toMatch(/\b(membership|identity|tenant|link|role)s?\b/i)
    }
  })
})
