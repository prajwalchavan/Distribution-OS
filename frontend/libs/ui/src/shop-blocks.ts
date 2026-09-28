/**
 * The pure half of the job home and the shop (founder, 2026-09-28), shared by both renderers so the
 * web and the phone cannot disagree about a colour, a column count or what "open" meant last time.
 */
import type { SemanticColors, StatusFamily } from './tokens.js'
import { layout } from './tokens.js'

// ---------------------------------------------------------------------------
// The brand's colour and initial — the picture before there are pictures
// ---------------------------------------------------------------------------

/**
 * The families a brand block may be drawn in: the accent and four status families, each as its own
 * `tint` fill with its own `fg` letter (>= 7:1 by construction, UX-00 §3.1). Brick is left out on
 * purpose — it means Overdue and Failed everywhere else, and a biscuit brand is neither.
 */
export type BrandTone = 'accent' | Exclude<StatusFamily, 'brick'>

export const BRAND_TONES: readonly BrandTone[] = ['accent', 'moss', 'ochre', 'clay', 'neutral']

/** "  Too  Yumm " and "too yumm" are the same brand. */
export function brandKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ')
}

/** The same brand is always the same colour: a string hash of its name, never a random pick. */
export function brandTone(name: string): BrandTone {
  const key = brandKey(name)
  let hash = 5381
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash * 33) ^ key.charCodeAt(i)) >>> 0
  }
  return BRAND_TONES[hash % BRAND_TONES.length] ?? 'neutral'
}

/**
 * The first letter or digit of the brand, upper case ("'Balaji" is B, "7 Up" is 7); a name in a
 * script with no case (Devanagari) gives its first character; an empty one gives a middle dot. No
 * Unicode property escape, so the phone's engine and the browser read it alike.
 */
export function brandInitial(name: string): string {
  const chars = Array.from(name.trim())
  const letter = chars.find(
    (ch) => ch.toLowerCase() !== ch.toUpperCase() || (ch >= '0' && ch <= '9'),
  )
  const pick = letter ?? chars[0]
  return pick === undefined ? '·' : pick.toUpperCase()
}

/** The block's fill and its letter, from the theme — never a hex of our own. */
export function brandColors(
  colors: SemanticColors,
  name: string,
): { readonly background: string; readonly foreground: string } {
  const tone = brandTone(name)
  if (tone === 'accent') return { background: colors.accent.tint, foreground: colors.accent.fg }
  const family = colors.status[tone]
  return { background: family.tint, foreground: family.fg }
}

// ---------------------------------------------------------------------------
// How many tiles across
// ---------------------------------------------------------------------------

/**
 * Two across on a phone, three on a small tablet, four to six on a desk. By WINDOW width, which is
 * what both renderers can read on their first frame; the desk rail takes 172 px of a 1280 px window,
 * which is why 1280 gets five and not six.
 */
export function tileColumns(width: number): number {
  if (width < 600) return 2
  if (width < layout.deskBreakpoint) return 3
  if (width < 1280) return 4
  if (width < 1600) return 5
  return 6
}

/** Splits `items` into rows of `columns` — the native grid has no CSS grid to lean on. */
export function chunkRows<T>(items: readonly T[], columns: number): T[][] {
  const size = Math.max(1, Math.floor(columns))
  const rows: T[][] = []
  for (let i = 0; i < items.length; i += size) rows.push(items.slice(i, i + size))
  return rows
}

// ---------------------------------------------------------------------------
// "More", remembered for the life of the app
// ---------------------------------------------------------------------------

const remembered = new Map<string, boolean>()

/** Was the group under `id` left open? `fallback` until somebody has touched it. */
export function moreGroupOpen(id: string, fallback: boolean): boolean {
  return remembered.get(id) ?? fallback
}

export function rememberMoreGroup(id: string, open: boolean): void {
  remembered.set(id, open)
}

/** For tests: forget every group. */
export function forgetMoreGroups(): void {
  remembered.clear()
}

// ---------------------------------------------------------------------------
// The job card's buttons
// ---------------------------------------------------------------------------

/** At most two secondaries: a third is dropped rather than squeezed onto a phone. */
export const MAX_SECONDARY = 2

export function visibleSecondaries<T>(actions: readonly T[] | undefined): readonly T[] {
  return (actions ?? []).slice(0, MAX_SECONDARY)
}
