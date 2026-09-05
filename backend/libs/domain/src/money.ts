/**
 * Money is always an integer number of paise. Floats never touch a ledger.
 * 1 rupee = 100 paise. Percentages are basis points (1% = 100 bps) so 8.33% is 833.
 */
export type Paise = number & { readonly __brand: 'Paise' }

export class MoneyError extends Error {
  override name = 'MoneyError'
}

export function paise(n: number): Paise {
  if (!Number.isSafeInteger(n)) throw new MoneyError(`Not an integer paise amount: ${n}`)
  return n as Paise
}

export const ZERO = paise(0)

/** Parse a rupee amount from a string or number exactly (no binary float drift). "21.16" -> 2116 */
export function fromRupees(value: string | number): Paise {
  const text = typeof value === 'number' ? value.toFixed(2) : value.trim().replace(/[₹,\s]/g, '')
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (!match) throw new MoneyError(`Cannot parse rupees: ${String(value)}`)
  const sign = match[1] ? -1 : 1
  const whole = Number(match[2])
  const frac = (match[3] ?? '0').padEnd(2, '0')
  return paise(sign * (whole * 100 + Number(frac)))
}

/** 2116 -> "21.16" (no grouping, for storage/export). */
export function toRupees(p: Paise): string {
  const sign = p < 0 ? '-' : ''
  const abs = Math.abs(p)
  const whole = Math.floor(abs / 100)
  const frac = abs % 100
  return `${sign}${whole}.${frac.toString().padStart(2, '0')}`
}

/** Indian digit grouping: 3383280 -> "₹33,83,280.00". Implemented by hand so Hermes/Intl differences never matter. */
export function formatINR(p: Paise, opts: { symbol?: boolean } = {}): string {
  const symbol = opts.symbol === false ? '' : '₹'
  const sign = p < 0 ? '-' : ''
  const abs = Math.abs(p)
  const whole = Math.floor(abs / 100).toString()
  const frac = (abs % 100).toString().padStart(2, '0')
  const last3 = whole.slice(-3)
  const rest = whole.slice(0, -3)
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}` : last3
  return `${sign}${symbol}${grouped}.${frac}`
}

export function add(a: Paise, b: Paise): Paise {
  return paise(a + b)
}

export function subtract(a: Paise, b: Paise): Paise {
  return paise(a - b)
}

export function sum(values: Iterable<Paise>): Paise {
  let total = 0
  for (const v of values) total += v
  return paise(total)
}

/** Round half up to the nearest paise (Indian invoicing convention). */
function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value)
}

/** Multiply a unit price by a quantity (quantity may be fractional for weight-based goods). */
export function multiply(unitPrice: Paise, quantity: number): Paise {
  if (!Number.isFinite(quantity)) throw new MoneyError(`Bad quantity: ${quantity}`)
  return paise(roundHalfUp(unitPrice * quantity))
}

/** amount * bps / 10000, rounded half up. percentOf(10000, 833) = 833 paise (8.33% of ₹100). */
export function percentOf(amount: Paise, bps: number): Paise {
  if (!Number.isSafeInteger(bps)) throw new MoneyError(`Basis points must be an integer: ${bps}`)
  return paise(roundHalfUp((amount * bps) / 10_000))
}

/** Round an invoice total to the nearest rupee (permitted by GST rule; return the rounding difference too). */
export function roundToRupee(p: Paise): { rounded: Paise; roundOff: Paise } {
  const rounded = paise(roundHalfUp(p / 100) * 100)
  return { rounded, roundOff: paise(rounded - p) }
}

/**
 * Split an amount across weights without losing a paise (largest-remainder method).
 * allocate(100, [1,1,1]) -> [34, 33, 33]. Used to spread invoice-level discounts over lines.
 */
export function allocate(total: Paise, weights: readonly number[]): Paise[] {
  if (weights.length === 0) throw new MoneyError('allocate needs at least one weight')
  const weightSum = weights.reduce((s, w) => s + w, 0)
  if (weightSum <= 0) throw new MoneyError('allocate needs positive weights')
  const raw = weights.map((w) => (total * w) / weightSum)
  const floors = raw.map((r) => Math.floor(r))
  let remainder = total - floors.reduce((s, f) => s + f, 0)
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (const { i } of order) {
    if (remainder <= 0) break
    floors[i] = (floors[i] ?? 0) + 1
    remainder -= 1
  }
  return floors.map((f) => paise(f))
}
