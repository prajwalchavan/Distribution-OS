/**
 * The floor under every state, kind, reason and mode the services send: a screen prints words, never
 * the identifier a column happens to hold.
 */
import { describe, expect, it } from 'vitest'

import { createTranslator, humaniseValue, wordFor } from './strings.js'

describe('humaniseValue', () => {
  it('reads a snake_case state as a sentence', () => {
    expect(humaniseValue('settled_with_variance')).toBe('Settled with variance')
    expect(humaniseValue('partially_paid')).toBe('Partially paid')
  })

  it('reads a SHOUTED constant (the column spells it the American way; the app gives it a word)', () => {
    expect(humaniseValue('POST_FULFILLMENT')).toBe('Post fulfillment')
    expect(humaniseValue('ON')).toBe('On')
  })

  it('splits camelCase before flattening the case, so a register name survives', () => {
    expect(humaniseValue('gstSalesRegister')).toBe('Gst sales register')
    expect(humaniseValue('deliveryPerformance')).toBe('Delivery performance')
  })

  it('reads a dotted audit action', () => {
    expect(humaniseValue('claims.settlement.record')).toBe('Claims settlement record')
  })

  it('leaves a single plain word alone but for its capital', () => {
    expect(humaniseValue('confirmed')).toBe('Confirmed')
  })

  it('never returns a machine word: no underscore, no dot, no double space', () => {
    for (const raw of [
      'needs_review',
      'brand_dms_import',
      'report_gstSalesRegister_csv',
      'gps.live_map_read',
      'a__b',
    ]) {
      const out = humaniseValue(raw)
      expect(out).not.toMatch(/[._]/)
      expect(out).not.toMatch(/ {2}/)
    }
  })

  it('survives the empty string', () => {
    expect(humaniseValue('')).toBe('')
  })
})

describe('wordFor', () => {
  const t = createTranslator('en', {
    'word.POST_FULFILLMENT': 'Credit',
    'word.upi': 'UPI',
  })

  it('prefers the app’s own word for a value that has one', () => {
    expect(wordFor(t, 'POST_FULFILLMENT')).toBe('Credit')
    expect(wordFor(t, 'upi')).toBe('UPI')
  })

  it('humanises a value nobody has written a word for', () => {
    expect(wordFor(t, 'settled_with_variance')).toBe('Settled with variance')
  })

  it('gives the em dash for nothing at all, so a nullable column needs no guard', () => {
    expect(wordFor(t, null)).toBe('—')
    expect(wordFor(t, undefined)).toBe('—')
    expect(wordFor(t, '')).toBe('—')
  })
})
