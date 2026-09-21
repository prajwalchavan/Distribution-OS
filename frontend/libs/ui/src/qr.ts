/**
 * DOS-125 — the QR grid, once, for both renderers.
 *
 * A shop on a counter PC could not pay its distributor: the "SCAN TO PAY" sheet showed the raw
 * `upi://pay?…` string as text, because the kit had no QR component at all. This is that component's
 * arithmetic, kept out of both renderers so the web `<svg>` and the React Native `<Svg>` draw the
 * IDENTICAL picture from one path, and so swapping the encoder later is one file rather than two.
 *
 * THE ONLY IMPORT SITE of `qrcode-generator` (zero dependencies, pure JS, MIT). Byte mode at error
 * correction level M: a UPI intent is ASCII with percent-escapes, M survives the smudges and glare of
 * a counter, and byte mode is what every UPI app expects.
 *
 * WHAT COMES BACK. `modules` is the side of the WHOLE tile in module units — the code plus its four
 * module quiet zone on each side — so a renderer can use it directly as the viewBox, and `d` is one
 * SVG path whose every subpath is a single dark module (`M x y h1 v1 h-1 z`), already offset into the
 * quiet zone. A scanner needs that white margin as much as it needs the black squares.
 */
import qrcode from 'qrcode-generator'

/** Four modules of white on every side: the margin the QR standard requires a scanner to find. */
export const QUIET_ZONE_MODULES = 4

/**
 * As many characters as this component promises to carry. A UPI intent is ~120; 1 000 is far beyond
 * anything this product puts in a QR, and past it the grid is too dense for a phone camera held over
 * a counter monitor. Longer values are refused loudly rather than drawn unscannably.
 */
export const MAX_QR_CHARS = 1_000

export interface QrPath {
  /** The side of the whole tile in module units, quiet zone included. */
  modules: number
  /** One `M x y h1 v1 h-1 z` per dark module, in the same module units. */
  d: string
}

/**
 * UTF-8, not Latin-1. `qrcode-generator` ships an 8-bit `stringToBytes` by default, which mangles any
 * character above U+00FF — a shop name in Devanagari, say. The factory is a module singleton, so this
 * is set once, here, at the one import site.
 */
qrcode.stringToBytes = (s: string): number[] => [...new TextEncoder().encode(s)]

export function qrPath(value: string): QrPath {
  if (value.trim() === '') throw new Error('qrPath: there is nothing to encode')
  if (value.length > MAX_QR_CHARS)
    throw new Error(`qrPath: ${String(value.length)} characters is more than a QR should carry`)

  const qr = qrcode(0, 'M')
  qr.addData(value, 'Byte')
  qr.make()

  const count = qr.getModuleCount()
  const parts: string[] = []
  for (let row = 0; row < count; row += 1) {
    for (let col = 0; col < count; col += 1) {
      if (!qr.isDark(row, col)) continue
      const x = col + QUIET_ZONE_MODULES
      const y = row + QUIET_ZONE_MODULES
      parts.push(`M${String(x)} ${String(y)}h1v1h-1z`)
    }
  }
  return { modules: count + QUIET_ZONE_MODULES * 2, d: parts.join('') }
}
