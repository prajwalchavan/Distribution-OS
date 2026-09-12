/**
 * Money formatting and parsing for the kit. Integer paise in, integer paise out — a float never
 * enters or leaves this module (UX-00 section 4.5 rules 2 and 3).
 *
 * The arithmetic and the Indian grouping live in `@dos/domain`; this file only adds the presentation
 * shapes the components need (the composed hero, the spoken label, a forgiving input parser).
 */
import { formatINR, fromRupees, paise, type Paise } from '@dos/domain'

import { t as defaultT, type Translator } from './strings.js'

/** `1245000` -> `"₹12,450.00"`. Pass `symbol: false` for a column whose head already states `₹`. */
export function formatMoney(value: number, opts: { symbol?: boolean } = {}): string {
  return formatINR(paise(Math.trunc(value)), { symbol: opts.symbol !== false })
}

/**
 * Hero money is composed: `₹` and the paise sit at 0.72 em, one weight lighter, in `text.secondary`;
 * the integer carries the full size (UX-00 section 4.5 rule 4). This returns the three parts so both
 * renderers can compose them identically.
 */
export interface MoneyParts {
  readonly sign: string
  readonly symbol: string
  /** Grouped integer rupees: `12,450`. */
  readonly integer: string
  /** Always two digits. */
  readonly fraction: string
}

export function splitMoney(value: number): MoneyParts {
  const whole = Math.trunc(value)
  const text = formatINR(paise(whole), { symbol: false })
  const negative = text.startsWith('-')
  const unsigned = negative ? text.slice(1) : text
  const dot = unsigned.lastIndexOf('.')
  return {
    sign: negative ? '-' : '',
    symbol: '₹',
    integer: unsigned.slice(0, dot),
    fraction: unsigned.slice(dot + 1),
  }
}

/** Screen readers get words, never `₹12,450.00` read as digits (UX-00 section 4.5 rule 9). */
export function speakMoney(value: number, translate: Translator = defaultT): string {
  const { sign, integer, fraction } = splitMoney(value)
  const rupees = `${sign}${integer.replace(/,/g, '')}`
  return fraction === '00'
    ? translate('money.spokenWhole', { rupees })
    : translate('money.spoken', { rupees, paise: fraction })
}

export type ParseResult =
  | { readonly ok: true; readonly paise: number }
  | { readonly ok: false; readonly reason: 'empty' | 'unparseable' }

/**
 * Parses what a person actually types into a rupee field: `1234`, `1,234`, `1234.5`, `₹1,234.50`,
 * `12.` (a half-typed decimal), with or without a leading minus. Returns integer paise; never a
 * float, and never a throw — the caller decides what to show for `unparseable`.
 */
export function parseRupees(text: string): ParseResult {
  const trimmed = text.trim()
  if (trimmed === '' || trimmed === '₹' || trimmed === '-') return { ok: false, reason: 'empty' }
  const normalised = trimmed.replace(/[₹,\s]/g, '').replace(/\.$/, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(normalised)) return { ok: false, reason: 'unparseable' }
  try {
    const value: Paise = fromRupees(normalised)
    return { ok: true, paise: value }
  } catch {
    return { ok: false, reason: 'unparseable' }
  }
}

/** What a `<RupeeInput>` shows while it is being edited: plain `12450.00`, no symbol, no grouping. */
export function toEditableRupees(value: number | null): string {
  if (value === null) return ''
  const whole = Math.trunc(value)
  const sign = whole < 0 ? '-' : ''
  const abs = Math.abs(whole)
  return `${sign}${Math.floor(abs / 100)}.${(abs % 100).toString().padStart(2, '0')}`
}

// ---------------------------------------------------------------------------
// The money pad (UX-00 section 6.3): rupees first, paise only after '.'
// ---------------------------------------------------------------------------

/**
 * The keys of the money `<NumberPad>`, in the order both renderers draw them (four rows of three).
 *
 * The pad enters RUPEES: `4 7 5 6` is ₹4,756.00, and paise are reached only through `.`
 * (`4 7 5 6 . 5` is ₹4,756.50). It used to append every tap as a paise digit, so a driver typing the
 * ₹4,756 on a bill recorded ₹47.56 while the web field on the same screen took rupees (DOS-060).
 * Clear is not a grid key in money mode: it sits beside Done, and `.` takes its place in the grid.
 */
export const MONEY_PAD_KEYS = [
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '.',
  '0',
  'back',
] as const

export type MoneyPadKey = (typeof MONEY_PAD_KEYS)[number] | 'clear'

/**
 * Ten rupee digits and two paise digits: ₹9,99,99,99,999.99 is 999999999999 paise, the same 12-digit
 * ceiling the pad has always had, and far inside `Number.MAX_SAFE_INTEGER`.
 */
const PAD_RUPEE_DIGITS = 10

/**
 * What the pad shows for an amount already in the field: `475600` -> `"4756"`, `3584312` ->
 * `"35843.12"`, `null` -> `""`. Whole rupees carry no `.00`, so the next digit typed is a rupee. The
 * pad has no minus key, so it shows the size of the amount, as it always did.
 */
export function padEntryFromPaise(value: number | null): string {
  if (value === null) return ''
  const abs = Math.abs(Math.trunc(value))
  return abs % 100 === 0 ? String(abs / 100) : toEditableRupees(abs)
}

/** The integer paise a pad entry means, through the same parser as the web field; `""` is `null`. */
export function paiseFromPadEntry(entry: string): number | null {
  const result = parseRupees(entry)
  return result.ok ? result.paise : null
}

/**
 * One key press on the money pad, the way a calculator takes it: `.` once (`0.` on an empty entry), at
 * most two digits after it and ten before it, a lone leading `0` replaced by the next digit, ⌫ drops
 * the last character and Clear empties the entry. A key the entry cannot take is ignored.
 */
export function pressMoneyPadKey(entry: string, key: MoneyPadKey): string {
  if (key === 'clear') return ''
  if (key === 'back') return entry.slice(0, -1)
  const dot = entry.indexOf('.')
  if (key === '.') {
    if (dot !== -1) return entry
    return entry === '' ? '0.' : `${entry}.`
  }
  if (dot !== -1) return entry.length - dot > 2 ? entry : `${entry}${key}`
  if (entry === '0') return key
  return entry.length >= PAD_RUPEE_DIGITS ? entry : `${entry}${key}`
}

/**
 * The entry a pad shows, decided on every render from what was typed and the value the parent holds.
 *
 * While the two agree, the typed text wins, so a pending `4756.` survives the parent storing 475600.
 * When they disagree, the parent wins: a screen that falls back to a default (`amount ?? owed`) or
 * changes the value from outside shows that value, never a figure that is not what gets recorded.
 */
export function reconcilePadEntry(entry: string, value: number | null): string {
  return paiseFromPadEntry(entry) === value ? entry : padEntryFromPaise(value)
}

/**
 * The pad's live preview, exactly as typed, with the rupees grouped the Indian way: `""` -> `"₹0"`,
 * `"4756"` -> `"₹4,756"`, `"4756."` -> `"₹4,756."`, `"4756.5"` -> `"₹4,756.5"`.
 */
export function formatPadEntry(entry: string): string {
  const dot = entry.indexOf('.')
  const rupees = dot === -1 ? entry : entry.slice(0, dot)
  const fraction = dot === -1 ? '' : entry.slice(dot)
  return `${formatMoney(Number(rupees) * 100).slice(0, -3)}${fraction}`
}

/** Axis and chip abbreviation: `420000000` -> `"₹42L"`. Money is abbreviated ONLY on an axis (UX-00 section 12). */
export function abbreviateMoney(value: number): string {
  const rupees = Math.trunc(value) / 100
  const abs = Math.abs(rupees)
  const sign = rupees < 0 ? '-' : ''
  const round = (n: number): string => (Number.isInteger(n) ? n.toString() : n.toFixed(1))
  if (abs >= 1_00_00_000) return `${sign}₹${round(abs / 1_00_00_000)}Cr`
  if (abs >= 1_00_000) return `${sign}₹${round(abs / 1_00_000)}L`
  if (abs >= 1_000) return `${sign}₹${round(abs / 1_000)}k`
  return `${sign}₹${round(abs)}`
}
