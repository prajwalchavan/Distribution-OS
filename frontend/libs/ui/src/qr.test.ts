/**
 * DOS-125 — the QR a shop actually scans.
 *
 * The point of these tests is that a REAL SCANNER would read the payload back, not that our encoder
 * agrees with itself: the grid `qrPath` produces is rasterised at 4 px per module and decoded with
 * jsQR, an independent implementation. The path is parsed rather than trusted, so what is decoded is
 * exactly what both renderers draw.
 */
import jsQR from 'jsqr'
import { describe, expect, it } from 'vitest'

import { MAX_QR_CHARS, QUIET_ZONE_MODULES, qrPath } from './qr.js'

/** A real UPI intent of the kind `billing.invoices.upiQr` answers. */
const INTENT =
  'upi://pay?pa=tarsun%40okhdfcbank&pn=Tarsun%20Enterprises&am=4561.00&cu=INR&tr=PAY-01A0B1C2D3E4&tn=Bill%20INV%2F0433'

/** Every dark module of a path, as [x, y] in module units. One `M x y h1 v1 h-1 z` per module. */
function darkModules(d: string): [number, number][] {
  const out: [number, number][] = []
  for (const match of d.matchAll(/M(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)h1v1h-1z/g)) {
    out.push([Number(match[1]), Number(match[2])])
  }
  return out
}

/** The grid as an RGBA bitmap a decoder can read: black modules on white, `scale` px per module. */
function rasterise(modules: number, dark: readonly [number, number][], scale = 4) {
  const size = modules * scale
  const data = new Uint8ClampedArray(size * size * 4).fill(255)
  for (const [mx, my] of dark) {
    for (let y = my * scale; y < (my + 1) * scale; y += 1) {
      for (let x = mx * scale; x < (mx + 1) * scale; x += 1) {
        const at = (y * size + x) * 4
        data[at] = 0
        data[at + 1] = 0
        data[at + 2] = 0
      }
    }
  }
  return { data, size }
}

describe('qrPath (DOS-125)', () => {
  it('encodes a upi://pay intent that decodes back to the same string', () => {
    const { modules, d } = qrPath(INTENT)
    const dark = darkModules(d)
    expect(dark.length).toBeGreaterThan(100)
    // The path is ONLY those squares: nothing else is drawn, so nothing else can hide in it.
    expect(d.replace(/M-?\d+(?:\.\d+)? -?\d+(?:\.\d+)?h1v1h-1z/g, '')).toBe('')
    expect(d.match(/M/g)?.length).toBe(dark.length)

    const { data, size } = rasterise(modules, dark)
    const decoded = jsQR(data, size, size)
    expect(decoded?.data).toBe(INTENT)
  })

  it('keeps the quiet zone: no dark module within four of any edge', () => {
    const { modules, d } = qrPath(INTENT)
    for (const [x, y] of darkModules(d)) {
      expect(x).toBeGreaterThanOrEqual(QUIET_ZONE_MODULES)
      expect(y).toBeGreaterThanOrEqual(QUIET_ZONE_MODULES)
      expect(x).toBeLessThan(modules - QUIET_ZONE_MODULES)
      expect(y).toBeLessThan(modules - QUIET_ZONE_MODULES)
    }
  })

  it('still encodes a 1 000-character value, and decodes it back', () => {
    const long = 'A'.repeat(MAX_QR_CHARS)
    const { modules, d } = qrPath(long)
    const { data, size } = rasterise(modules, darkModules(d), 4)
    expect(jsQR(data, size, size)?.data).toBe(long)
  })

  it('refuses an empty value rather than drawing an unscannable tile', () => {
    expect(() => qrPath('')).toThrow()
    expect(() => qrPath('   ')).toThrow()
    expect(() => qrPath('A'.repeat(MAX_QR_CHARS + 1))).toThrow()
  })
})
