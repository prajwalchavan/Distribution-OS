/**
 * Quantity is dual-unit and never toggled: `2 cs + 6 pc = 54 pc` (UX-00 section 4.5 rule 7). State is
 * always integer PIECES; the case size comes from the row (`tenant_products.case_size_override`
 * else `product_variants.default_case_size`) and is only ever a display and step multiplier.
 */
import { toCasesAndPieces, toPieces, type Pieces } from '@dos/domain'

import { t as defaultT, type Translator } from './strings.js'

export interface CasesAndPieces {
  readonly cases: number
  readonly loose: number
  readonly pieces: number
}

/**
 * A whole count, grouped the Indian way: `1,008` · `82,693` · `1,24,500`.
 *
 * UX-00 §4.5 rule 3 is "Indian grouping, always" and rule 1 is "every number is tabular".
 * `formatMoney` already does it for paise; a piece count printed with `String(n)` does not, and the
 * godown prints big ones. Done by hand rather than through `Intl` so a Hermes built without full
 * ICU groups exactly as the browser does.
 */
export function formatCount(value: number): string {
  const sign = value < 0 ? '-' : ''
  const whole = Math.abs(Math.trunc(value)).toString()
  if (whole.length <= 3) return `${sign}${whole}`
  const last3 = whole.slice(-3)
  const rest = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')
  return `${sign}${rest},${last3}`
}

/** Split integer pieces into cases + loose pieces. `caseSize` must be a positive integer. */
export function splitQty(pieces: number, caseSize: number): CasesAndPieces {
  const whole = Math.max(0, Math.trunc(pieces))
  const { cases, pieces: loose } = toCasesAndPieces(whole as Pieces, caseSize)
  return { cases, loose, pieces: whole }
}

/** Compose pieces from a case count and loose pieces. */
export function joinQty(cases: number, loose: number, caseSize: number): number {
  return toPieces(Math.max(0, Math.trunc(cases)), Math.max(0, Math.trunc(loose)), caseSize)
}

/**
 * The line under a stepper: `2 cs = 48 pc`, or `2 cs + 6 pc = 54 pc` when loose pieces exist — and
 * just `7 pc` when there is no whole case at all.
 *
 * UX-00 §4.5 rule 7 asks for the DUAL unit, and below one case there is no dual unit to state:
 * "0 cs + 7 pc = 7 pc" is three numbers for one fact, two of them zero and one of them repeated.
 * Measured on the delivery app's check-in, where the crew reads a dozen part-lots back to the godown
 * line by line.
 */
export function caseLine(
  pieces: number,
  caseSize: number,
  translate: Translator = defaultT,
): string {
  const q = splitQty(pieces, caseSize)
  if (q.cases === 0) return translate('qty.piecesOnly', { pieces: q.pieces })
  return q.loose === 0
    ? translate('qty.caseLine', { cases: q.cases, pieces: q.pieces })
    : translate('qty.caseLineWithLoose', { cases: q.cases, loose: q.loose, pieces: q.pieces })
}

/** One step of the `+` / `-` control: a whole case, never below zero, never above a hard cap. */
export function stepByCase(pieces: number, direction: 1 | -1, caseSize: number): number {
  if (!Number.isSafeInteger(caseSize) || caseSize <= 0) return Math.max(0, Math.trunc(pieces))
  return Math.max(0, Math.trunc(pieces) + direction * caseSize)
}

/**
 * The stepper's state (UX-00 section 6.4). `overAvailable` is ACCEPTED, not blocked — the row says what
 * happens ("Only 14 cs available — rest short-supplied"); `blocked` is set by the caller from a
 * business rule (credit stop, minimum order) and always carries a reason.
 */
export type QtyState = 'atZero' | 'default' | 'overAvailable' | 'blocked' | 'disabled'

export function qtyState(input: {
  pieces: number
  availablePieces?: number | null
  blocked?: boolean
  disabled?: boolean
}): QtyState {
  if (input.disabled) return 'disabled'
  if (input.blocked) return 'blocked'
  if (input.pieces <= 0) return 'atZero'
  if (
    input.availablePieces !== null &&
    input.availablePieces !== undefined &&
    input.pieces > input.availablePieces
  ) {
    return 'overAvailable'
  }
  return 'default'
}

/** `40 cs available`, from `sellable_stock` pieces. Whole cases only — a shop orders in cases. */
export function availableLine(
  availablePieces: number,
  caseSize: number,
  translate: Translator = defaultT,
): string {
  return translate('qty.available', { cases: splitQty(availablePieces, caseSize).cases })
}

/**
 * What a printed bill line says about quantity, above its amount: what was TYPED, and what that came
 * to in pieces — `2 cs + 3 pc · 51 pc`, or just `51 pc` when nothing about the entry is recorded.
 *
 * The entry is reprinted for ever (docs/17 A3): `enteredQty` + `enteredUnit` with the pack size that
 * applied at the time, never recomputed from today's case size, because the case size can change and
 * a reissued bill must still read the way it was issued. `freeQtyPcs` is appended as its own clause
 * because free goods carry quantity and no value, and a reader who cannot see them cannot check the
 * scheme that gave them.
 */
export function billLineQty(
  line: {
    qtyPcs: number
    freeQtyPcs?: number | null
    enteredQty?: number | null
    enteredUnit?: string | null
    packSizeAtEntry?: number | null
    caseSize?: number | null
  },
  translate: Translator = defaultT,
): string {
  const pieces = Math.max(0, Math.trunc(line.qtyPcs))
  const pc = translate('qty.piece')
  const parts: string[] = []

  const pack = line.packSizeAtEntry ?? line.caseSize ?? null
  const entered = line.enteredQty ?? null
  const unit = line.enteredUnit ?? null
  // Only worth printing when the entry says something the piece count does not: a case count, or an
  // inner-pack count. `piece` entry of 51 pieces would print "51 pc · 51 pc".
  if (entered !== null && unit !== null && unit !== 'piece' && pack !== null && pack > 1) {
    const unitWord = unit === 'case' ? translate('qty.case') : unit
    parts.push(`${String(entered)} ${unitWord}`)
    const loose = pieces - entered * pack
    if (loose > 0) parts.push(`+ ${String(loose)} ${pc}`)
  }

  const total = `${String(pieces)} ${pc}`
  const head = parts.length === 0 ? total : `${parts.join(' ')} · ${total}`
  const free = Math.max(0, Math.trunc(line.freeQtyPcs ?? 0))
  return free === 0 ? head : `${head} · ${translate('qty.freeGoods', { pieces: free })}`
}
