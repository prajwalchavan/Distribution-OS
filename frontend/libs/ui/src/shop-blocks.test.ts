/**
 * The pure half of the job home and the shop (founder, 2026-09-28): the brand colour and initial the
 * shopkeeper's tiles are drawn with before there are photographs, how many tiles go across, the
 * "More" memory and the cap on a job card's buttons. Both renderers call these; nothing here renders.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import {
  BRAND_TONES,
  MAX_SECONDARY,
  brandColors,
  brandInitial,
  brandKey,
  brandTone,
  chunkRows,
  forgetMoreGroups,
  moreGroupOpen,
  rememberMoreGroup,
  tileColumns,
  visibleSecondaries,
} from './shop-blocks.js'
import { en } from './strings.js'
import { darkColors, lightColors } from './tokens.js'

describe('the brand block: the same brand is always the same colour', () => {
  it('gives one brand one tone, however it is spaced or cased', () => {
    expect(brandTone('Too Yumm')).toBe(brandTone('  too   yumm '))
    expect(brandTone('CAMPA')).toBe(brandTone('campa'))
    expect(brandKey('  Too   Yumm ')).toBe('too yumm')
  })

  it('is a pure function of the name: asked twice, it answers the same', () => {
    for (const name of ['Campa', 'Too Yumm', 'MOM', 'Balaji', 'Masti Oye', 'Parle', 'Haldiram']) {
      expect(brandTone(name)).toBe(brandTone(name))
    }
  })

  it('draws only from the families the tokens already have, and never from brick', () => {
    expect(BRAND_TONES).toEqual(['accent', 'moss', 'ochre', 'clay', 'neutral'])
    for (const name of [
      'Campa',
      'Too Yumm',
      'MOM',
      'Balaji',
      'Masti Oye',
      'Parle',
      'Haldiram',
      '',
    ]) {
      expect(BRAND_TONES).toContain(brandTone(name))
      expect(brandTone(name)).not.toBe('brick')
    }
  })

  it('spreads a real catalogue over more than one colour', () => {
    const tones = new Set(
      ['Campa', 'Too Yumm', 'MOM', 'Balaji', 'Masti Oye', 'Parle', 'Haldiram', 'Bingo'].map(
        brandTone,
      ),
    )
    expect(tones.size).toBeGreaterThan(2)
  })

  it('resolves to a token pair in both themes — a fill and the letter drawn on it, never a new hex', () => {
    for (const colors of [lightColors, darkColors]) {
      const allowed = new Set<string>([
        colors.accent.tint,
        colors.accent.fg,
        ...Object.values(colors.status).flatMap((family) => [family.tint, family.fg]),
      ])
      for (const name of ['Campa', 'Too Yumm', 'MOM', 'Balaji']) {
        const pair = brandColors(colors, name)
        expect(allowed).toContain(pair.background)
        expect(allowed).toContain(pair.foreground)
        expect(pair.background).not.toBe(pair.foreground)
        expect(pair.background).not.toBe(colors.status.brick.tint)
      }
    }
  })

  it('takes the first letter or digit, upper case', () => {
    expect(brandInitial('campa')).toBe('C')
    expect(brandInitial("  'balaji")).toBe('B')
    expect(brandInitial('7 Up')).toBe('7')
    expect(brandInitial('too yumm')).toBe('T')
  })

  it('never returns an empty picture', () => {
    expect(brandInitial('')).toBe('·')
    expect(brandInitial('   ')).toBe('·')
    // A script with no case still gets its own first character, not a dot.
    expect(brandInitial('हल्दीराम')).toBe('ह')
  })
})

describe('the tile grid: two across on a phone, four to six on a desk', () => {
  it('puts two tiles across every phone width, 360 included', () => {
    for (const width of [320, 360, 375, 390, 412, 599]) expect(tileColumns(width)).toBe(2)
  })

  it('three on a small tablet, then four, five and six as the desk widens', () => {
    expect(tileColumns(768)).toBe(3)
    expect(tileColumns(1024)).toBe(4)
    expect(tileColumns(1280)).toBe(5)
    expect(tileColumns(1440)).toBe(5)
    expect(tileColumns(1600)).toBe(6)
    expect(tileColumns(2560)).toBe(6)
  })

  it('cuts children into rows for the native grid, keeping the last short row short', () => {
    expect(chunkRows([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunkRows([], 2)).toEqual([])
    expect(chunkRows([1, 2], 0)).toEqual([[1], [2]])
  })
})

describe('"More" remembers open or closed for as long as the app runs', () => {
  beforeEach(() => {
    forgetMoreGroups()
  })

  it('starts where the screen asked until somebody touches it', () => {
    expect(moreGroupOpen('delivery.home.more', false)).toBe(false)
    expect(moreGroupOpen('delivery.home.more', true)).toBe(true)
  })

  it('keeps what the person chose, per group', () => {
    rememberMoreGroup('delivery.home.more', true)
    expect(moreGroupOpen('delivery.home.more', false)).toBe(true)
    expect(moreGroupOpen('owner.home.more', false)).toBe(false)
    rememberMoreGroup('delivery.home.more', false)
    expect(moreGroupOpen('delivery.home.more', true)).toBe(false)
  })
})

describe('a job card carries one primary and at most two secondaries', () => {
  it('drops a third rather than squeezing it onto a phone', () => {
    expect(MAX_SECONDARY).toBe(2)
    expect(visibleSecondaries(['a', 'b', 'c'])).toEqual(['a', 'b'])
    expect(visibleSecondaries(undefined)).toEqual([])
  })
})

describe('the words the new blocks print are the trade s own and short', () => {
  it('every label is <= 20 characters (UX-00 §12)', () => {
    for (const key of [
      'job.next',
      'job.nothingWaiting',
      'job.more',
      'job.show',
      'job.hide',
      'shop.add',
      'shop.oneItem',
    ] as const) {
      expect(en[key].length, key).toBeLessThanOrEqual(20)
    }
  })

  it('no accounting or software word on a home', () => {
    const words = [
      en['job.next'],
      en['job.nothingWaiting'],
      en['job.more'],
      en['shop.add'],
      en['shop.items'],
    ].join(' ')
    expect(words).not.toMatch(/\b(invoice|ledger|sync|submit|record|entity|status)\b/i)
  })
})
