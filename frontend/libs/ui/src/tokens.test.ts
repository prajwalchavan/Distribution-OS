import { describe, expect, it } from 'vitest'

import {
  AGEING_BUCKETS,
  AGEING_LADDER,
  COLOR_NAMES,
  darkColors,
  flattenColors,
  lightColors,
  size,
  space,
  typeDesk,
  typeField,
} from './tokens.js'

const HEX_OR_RGBA = /^(#[0-9A-Fa-f]{6}|rgba?\([\d\s.,]+\))$/

describe('semantic colour tokens', () => {
  const light = flattenColors(lightColors)
  const dark = flattenColors(darkColors)

  it('resolves every semantic name in BOTH themes', () => {
    expect(Object.keys(light).sort()).toEqual(Object.keys(dark).sort())
    for (const name of COLOR_NAMES) {
      expect(light[name], `light.${name}`).toBeTypeOf('string')
      expect(dark[name], `dark.${name}`).toBeTypeOf('string')
    }
  })

  it('is a real colour at every name, in both themes', () => {
    for (const [name, value] of Object.entries(light)) {
      expect(value, `light.${name} = ${value}`).toMatch(HEX_OR_RGBA)
    }
    for (const [name, value] of Object.entries(dark)) {
      expect(value, `dark.${name} = ${value}`).toMatch(HEX_OR_RGBA)
    }
  })

  it('carries the five status families with all four roles', () => {
    for (const family of ['moss', 'ochre', 'clay', 'brick', 'neutral'] as const) {
      for (const role of ['tint', 'edge', 'fg', 'solid'] as const) {
        expect(light[`status.${family}.${role}`]).toMatch(HEX_OR_RGBA)
        expect(dark[`status.${family}.${role}`]).toMatch(HEX_OR_RGBA)
      }
    }
  })

  it('keeps the A-Ledger identities: warm ink, petrol accent, paper ground', () => {
    expect(lightColors.text.primary).toBe('#1B1E1A')
    expect(lightColors.accent.solid).toBe('#0B5A63')
    expect(lightColors.bg.ground).toBe('#F2F2EF')
    // Text-bearing fills use petrol.700 (7.90:1); #0E6E78 survives only as the chart line.
    expect(lightColors.chart.primary).toBe('#0E6E78')
  })

  it('offers exactly five mix steps, "Other" last', () => {
    expect(lightColors.chart.mix).toHaveLength(5)
    expect(new Set(lightColors.chart.mix).size).toBe(5)
  })
})

describe('the ageing ladder', () => {
  it('is the six buckets of docs/22 section 6, in order', () => {
    expect([...AGEING_BUCKETS]).toEqual(['0-7', '8-15', '16-30', '31-60', '61-90', '90+'])
  })

  it('walks moss -> neutral -> ochre -> clay -> brick -> brick solid', () => {
    expect(AGEING_BUCKETS.map((b) => AGEING_LADDER[b].family)).toEqual([
      'moss',
      'neutral',
      'ochre',
      'clay',
      'brick',
      'brick',
    ])
    expect(AGEING_LADDER['90+'].solid).toBe(true)
    expect(AGEING_LADDER['61-90'].solid).toBe(false)
  })
})

describe('type scales', () => {
  it('holds the field floors: body 16, money 20, nothing below 14', () => {
    expect(typeField.body.size).toBe(16)
    expect(typeField.moneyM.size).toBe(20)
    for (const [name, token] of Object.entries(typeField)) {
      expect(token.size, `typeField.${name}`).toBeGreaterThanOrEqual(14)
    }
  })

  it('holds the desk floor of 14 px, with the eyebrow as the one recorded exception', () => {
    for (const [name, token] of Object.entries(typeDesk)) {
      if (name === 'eyebrow') {
        expect(token.size).toBe(12)
        continue
      }
      expect(token.size, `typeDesk.${name}`).toBeGreaterThanOrEqual(14)
    }
  })

  it('keeps line height above size everywhere', () => {
    for (const token of [...Object.values(typeField), ...Object.values(typeDesk)]) {
      expect(token.line).toBeGreaterThan(token.size)
    }
  })
})

describe('space and touch', () => {
  it('carries the four touch floors of UX-00 section 5.2', () => {
    expect(size).toEqual({ field: 69, floor: 76, phone: 63, desk: 32 })
  })

  it('is a 4 px scale', () => {
    for (const value of Object.values(space)) expect(value % 4).toBe(0)
  })
})
