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
