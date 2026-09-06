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

/** The line under a stepper: `2 cs = 48 pc`, or `2 cs + 6 pc = 54 pc` when loose pieces exist. */
export function caseLine(
  pieces: number,
  caseSize: number,
  translate: Translator = defaultT,
): string {
  const q = splitQty(pieces, caseSize)
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
