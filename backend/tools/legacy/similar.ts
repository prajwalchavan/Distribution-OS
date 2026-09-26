import { nameKey } from './text.js'

/** The set of overlapping three-letter windows of a name's letters-and-digits (`pg_trgm`'s idea, without the padding). */
export function trigrams(raw: string): Set<string> {
  const k = nameKey(raw)
  const out = new Set<string>()
  if (k.length <= 3) {
    if (k.length > 0) out.add(k)
    return out
  }
  for (let i = 0; i + 3 <= k.length; i++) out.add(k.slice(i, i + 3))
  return out
}

/** Jaccard similarity of two trigram sets, 0..1. */
export function similarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let common = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const g of small) if (large.has(g)) common++
  return common / (a.size + b.size - common)
}

/**
 * Pairs of names that are probably one shop spelt two ways: equal once punctuation and spacing are gone, or
 * at least `threshold` alike by trigrams. Quadratic on purpose — a distributor's master is hundreds to a few
 * thousand rows — and it only ever REPORTS pairs; nothing is merged.
 */
export function similarPairs(
  names: readonly string[],
  threshold = 0.8,
): { a: number; b: number; exact: boolean }[] {
  const grams = names.map(trigrams)
  const keys = names.map(nameKey)
  const out: { a: number; b: number; exact: boolean }[] = []
  for (let i = 0; i < names.length; i++) {
    const gi = grams[i]
    if (!gi) continue
    for (let j = i + 1; j < names.length; j++) {
      const gj = grams[j]
      if (!gj) continue
      if (keys[i] !== '' && keys[i] === keys[j]) out.push({ a: i, b: j, exact: true })
      else if (similarity(gi, gj) >= threshold) out.push({ a: i, b: j, exact: false })
    }
  }
  return out
}
