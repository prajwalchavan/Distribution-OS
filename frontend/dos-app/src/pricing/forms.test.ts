/**
 * DOS-212 and DOS-214 — every payload the desk builds is one the contract accepts, in the right unit.
 *
 * Each body is parsed with the contract's OWN input schema (`@dos/contracts`, the same Zod the server
 * runs), so "the screen builds it" and "the server takes it" cannot drift apart. The values are the
 * simulation's day-1 ones: Navjeevan Kirana's ₹8,000 / 7 days, a cash-only counter (`stop` + `ON`), a
 * final shop rate, a 2.5 % line scheme and a "2 % off bills over ₹5,000" order scheme, exclusive.
 */
import {
  SetCreditInput,
  SetPriceListItemsInput,
  UpsertOverrideInput,
  UpsertSchemeInput,
  type RetailerPriceOverride,
  type Scheme,
} from '@dos/contracts'
import { describe, expect, it } from 'vitest'

import {
  addDays,
  bpsToPercentText,
  creditDraftOf,
  creditPayload,
  creditUnchanged,
  endOverride,
  isIsoDate,
  newOverrideDraft,
  newSchemeDraft,
  overridePayload,
  overrideState,
  percentToBps,
  priceItemPayload,
  schemeDraftOf,
  schemePayload,
  schemeState,
  spokenDate,
  wholeNumber,
  type CreditShop,
} from './forms'

const ID = '01a0c3d0-5653-755b-9a6d-cf98f867d55a'
const SHOP = '01a0c3d2-8bd1-7160-974a-e85beeaddd33'
const ITEM = '01a0c3d3-033d-7309-8069-b0b7f4ee1487'
const KEY = 'idem-key-0001'
const TODAY = '2026-09-21'

const shop: CreditShop = {
  id: SHOP,
  tier: 'C',
  creditLimitPaise: 0,
  creditLimitBills: 0,
  creditDays: 0,
  creditMode: 'indicate',
  paymentTerms: 'POST_FULFILLMENT',
}

describe('typed numbers and dates', () => {
  it('reads a percentage into basis points, and refuses what is not one', () => {
    expect(percentToBps('2')).toBe(200)
    expect(percentToBps('2.5')).toBe(250)
    expect(percentToBps('12.25')).toBe(1225)
    expect(percentToBps(' 2% ')).toBe(200)
    expect(percentToBps('100')).toBe(10_000)
    expect(percentToBps('100.5')).toBeNull()
    expect(percentToBps('2.555')).toBeNull()
    expect(percentToBps('two')).toBeNull()
    expect(percentToBps('')).toBeNull()
    expect(bpsToPercentText(250)).toBe('2.5')
    expect(bpsToPercentText(200)).toBe('2')
    expect(bpsToPercentText(1225)).toBe('12.25')
  })

  it('reads a whole count, and a real calendar day', () => {
    expect(wholeNumber(' 12 ')).toBe(12)
    expect(wholeNumber('1.5')).toBeNull()
    expect(wholeNumber('-2')).toBeNull()
    expect(isIsoDate('2026-09-21')).toBe(true)
    expect(isIsoDate('2026-02-30')).toBe(false)
    expect(isIsoDate('21/09/2026')).toBe(false)
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(spokenDate('2026-09-27')).toBe('27 Sep 2026')
    expect(spokenDate('not a date')).toBe('not a date')
  })
})

describe('DOS-212 a shop’s credit: limit, days, mode AND terms in one setCredit', () => {
  it('opens on what the shop has now', () => {
    expect(creditDraftOf(shop)).toEqual({
      limitPaise: 0,
      daysText: '0',
      mode: 'indicate',
      terms: 'POST_FULFILLMENT',
    })
    expect(creditUnchanged(shop, creditDraftOf(shop))).toBe(true)
  })

  it('builds the day-1 warn shop and the cash-only counter, both accepted by the contract', () => {
    const warn = creditPayload(shop, {
      limitPaise: 800_000,
      daysText: '7',
      mode: 'indicate',
      terms: 'POST_FULFILLMENT',
    })
    expect(warn.ok).toBe(true)
    const cashOnly = creditPayload(shop, {
      limitPaise: 0,
      daysText: '0',
      mode: 'stop',
      terms: 'ON',
    })
    expect(cashOnly.ok && cashOnly.input).toMatchObject({ creditMode: 'stop', paymentTerms: 'ON' })
    for (const built of [warn, cashOnly]) {
      if (!built.ok) throw new Error(built.problem)
      const parsed = SetCreditInput.safeParse({ ...built.input, idempotencyKey: KEY })
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    }
  })

  it('keeps the tier and the open-bill count, and never sends an empty field as zero', () => {
    const strict = creditPayload(
      { ...shop, tier: 'A', creditLimitBills: 3 },
      { limitPaise: 800_000, daysText: '7', mode: 'strict', terms: 'POST_FULFILLMENT' },
    )
    expect(strict.ok && strict.input.tier).toBe('A')
    expect(strict.ok && strict.input.creditLimitBills).toBe(3)
    expect(
      creditPayload(shop, { limitPaise: null, daysText: '7', mode: 'strict', terms: 'ON' }),
    ).toEqual({ ok: false, problem: 'px.needLimit' })
    expect(
      creditPayload(shop, { limitPaise: 100, daysText: 'abc', mode: 'strict', terms: 'ON' }),
    ).toEqual({ ok: false, problem: 'px.needDays' })
    expect(
      creditPayload(shop, { limitPaise: 100, daysText: '400', mode: 'strict', terms: 'ON' }),
    ).toEqual({ ok: false, problem: 'px.needDays' })
  })
})

describe('DOS-214 one rate on a price list', () => {
  it('sends only the changed item, keyed on its variant', () => {
    const built = priceItemPayload({
      priceListId: ID,
      itemId: ITEM,
      variantId: SHOP,
      ratePaise: 4_250,
      inclusiveOfGst: false,
    })
    if (!built.ok) throw new Error(built.problem)
    expect(built.input.items).toHaveLength(1)
    const parsed = SetPriceListItemsInput.safeParse({ ...built.input, idempotencyKey: KEY })
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it('refuses a missing item and a zero or empty rate', () => {
    const base = { priceListId: ID, itemId: ITEM, inclusiveOfGst: false }
    expect(priceItemPayload({ ...base, variantId: '', ratePaise: 100 })).toEqual({
      ok: false,
      problem: 'px.needItem',
    })
    expect(priceItemPayload({ ...base, variantId: SHOP, ratePaise: null })).toEqual({
      ok: false,
      problem: 'px.needRate',
    })
    expect(priceItemPayload({ ...base, variantId: SHOP, ratePaise: 0 })).toEqual({
      ok: false,
      problem: 'px.needRate',
    })
  })
})

describe('DOS-214 a shop’s own rate: set it final, then end it', () => {
  const draft = {
    ...newOverrideDraft(TODAY),
    retailerId: SHOP,
    variantId: ITEM,
    ratePaise: 3_900,
    final: true,
    note: 'Matched the wholesaler',
  }

  it('sets a final rate the contract accepts', () => {
    const built = overridePayload(ID, draft)
    if (!built.ok) throw new Error(built.problem)
    expect(built.input).toMatchObject({ final: true, validFrom: TODAY, validTo: null })
    const parsed = UpsertOverrideInput.safeParse({ ...built.input, idempotencyKey: KEY })
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it('names what is missing or wrong instead of sending it', () => {
    expect(overridePayload(ID, { ...draft, retailerId: '' })).toEqual({
      ok: false,
      problem: 'px.needShop',
    })
    expect(overridePayload(ID, { ...draft, validTo: '2026-09-01' })).toEqual({
      ok: false,
      problem: 'px.toBeforeFrom',
    })
    expect(overridePayload(ID, { ...draft, validFrom: '21-09-2026' })).toEqual({
      ok: false,
      problem: 'px.badFrom',
    })
  })

  const row: RetailerPriceOverride = {
    id: ID,
    retailerId: SHOP,
    variantId: ITEM,
    ratePaise: 3_900,
    final: true,
    validFrom: '2026-09-01',
    validTo: null,
    approvedBy: null,
    note: null,
  }

  it('ends an older rate yesterday, so the shop is on its list price from today', () => {
    const ended = endOverride(row, TODAY)
    expect(ended.payload.validTo).toBe('2026-09-20')
    expect(ended.backOn).toBe(TODAY)
    expect(overrideState({ ...row, validTo: ended.payload.validTo }, TODAY)).toBe('ended')
    const parsed = UpsertOverrideInput.safeParse({ ...ended.payload, idempotencyKey: KEY })
    expect(parsed.success).toBe(true)
  })

  it('ends a rate that began today on its first day, and says the list returns tomorrow', () => {
    const ended = endOverride({ ...row, validFrom: TODAY }, TODAY)
    expect(ended.payload.validTo).toBe(TODAY)
    expect(ended.backOn).toBe('2026-09-22')
    expect(overrideState({ ...row, validFrom: '2026-09-25' }, TODAY)).toBe('upcoming')
    expect(overrideState(row, TODAY)).toBe('running')
  })
})

describe('DOS-214 a scheme: a percentage line scheme and an order-value scheme', () => {
  it('builds "2.5 % off these items" for tier A and B shops, stacking', () => {
    const built = schemePayload(ID, {
      ...newSchemeDraft(TODAY),
      name: 'Festive 2.5% on biscuits',
      rewardKind: 'line_pct',
      rewardText: '2.5',
      scopeMode: 'items',
      variantIds: [ITEM],
      tiers: ['A', 'B'],
    })
    if (!built.ok) throw new Error(built.problem)
    expect(built.input).toMatchObject({
      rewardValue: 250,
      triggerKind: 'qty',
      triggerUnit: 'pcs',
      triggerMin: 1,
      scope: { variantIds: [ITEM] },
      applicability: { tiers: ['A', 'B'] },
      stackable: true,
      validTo: '2026-10-21',
    })
    const parsed = UpsertSchemeInput.safeParse({ ...built.input, idempotencyKey: KEY })
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it('builds "2 % off bills over ₹5,000", exclusive, with its threshold in paise', () => {
    const built = schemePayload(ID, {
      ...newSchemeDraft(TODAY),
      name: 'Big bill 2%',
      rewardKind: 'order_pct',
      rewardText: '2',
      triggerKind: 'value',
      triggerPaise: 500_000,
      exclusive: true,
      fundingSource: 'distributor',
      validTo: '2026-09-30',
    })
    if (!built.ok) throw new Error(built.problem)
    expect(built.input).toMatchObject({
      rewardValue: 200,
      triggerKind: 'value',
      triggerUnit: 'inr',
      triggerMin: 500_000,
      stackable: false,
      fundingSource: 'distributor',
      scope: { all: true },
    })
    const parsed = UpsertSchemeInput.safeParse({ ...built.input, idempotencyKey: KEY })
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
  })

  it('says what is wrong in the desk’s words before the server has to', () => {
    const base = { ...newSchemeDraft(TODAY), name: 'X', rewardText: '2' }
    expect(schemePayload(ID, { ...base, name: '  ' })).toEqual({
      ok: false,
      problem: 'px.needName',
    })
    expect(schemePayload(ID, { ...base, rewardText: '150' })).toEqual({
      ok: false,
      problem: 'px.needPercent',
    })
    expect(schemePayload(ID, { ...base, validTo: '2026-09-01' })).toEqual({
      ok: false,
      problem: 'px.toBeforeFrom',
    })
    expect(schemePayload(ID, { ...base, scopeMode: 'items', variantIds: [] })).toEqual({
      ok: false,
      problem: 'px.needItems',
    })
    expect(
      schemePayload(ID, {
        ...base,
        rewardKind: 'per_unit_amount',
        rewardPaise: 1_500,
        triggerKind: 'value',
        triggerPaise: 100_000,
      }),
    ).toEqual({ ok: false, problem: 'px.perUnitNeedsUnit' })
    expect(schemePayload(ID, { ...base, triggerKind: 'value', triggerPaise: null })).toEqual({
      ok: false,
      problem: 'px.needBillValue',
    })
  })

  it('hands back what the editor does not offer, unchanged, when an existing scheme is saved', () => {
    const seeded: Scheme = {
      id: ID,
      name: 'Parle slab',
      brandId: ITEM,
      scope: { brandIds: [ITEM] },
      triggerKind: 'qty',
      triggerMin: 2,
      triggerUnit: 'case',
      slabs: [{ min: 5, value: 300 }],
      rewardKind: 'per_unit_amount',
      rewardValue: 1_500,
      freeVariantId: null,
      applicability: { beatIds: [SHOP] },
      validFrom: '2026-09-01',
      validTo: '2026-12-31',
      stackable: true,
      final: false,
      gstOnFreeGoods: false,
      pricingDateMode: 'order',
      version: 3,
      fundingSource: 'company',
      claimable: true,
      claimWindowDays: 45,
      sourceRef: 'PARLE/CIRC/77',
      active: true,
    }
    const draft = schemeDraftOf(seeded)
    expect(draft.scopeMode).toBe('kept')
    expect(draft.rewardPaise).toBe(1_500)
    expect(draft.triggerCountText).toBe('2')
    const built = schemePayload(ID, { ...draft, active: false })
    if (!built.ok) throw new Error(built.problem)
    expect(built.input).toMatchObject({
      scope: { brandIds: [ITEM] },
      slabs: [{ min: 5, value: 300 }],
      brandId: ITEM,
      claimable: true,
      claimWindowDays: 45,
      sourceRef: 'PARLE/CIRC/77',
      applicability: { beatIds: [SHOP] },
      active: false,
      triggerUnit: 'case',
      triggerMin: 2,
    })
    const parsed = UpsertSchemeInput.safeParse({ ...built.input, idempotencyKey: KEY })
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true)
    expect(schemeState({ ...seeded, active: false }, TODAY)).toBe('paused')
    expect(schemeState(seeded, TODAY)).toBe('running')
    expect(schemeState({ ...seeded, validTo: '2026-09-20' }, TODAY)).toBe('ended')
  })
})
