/**
 * The rule-based half of order intake: a shopkeeper's message split into "how many, of what".
 *
 * PURE AND DETERMINISTIC — no database, no clock, no network. It runs as the `deterministic` LLM
 * driver's answer (`platform/llm.ts`), which is what makes every spec and every `pnpm smoke` probe
 * network-free, and it runs as the FALLBACK whenever the Anthropic driver refuses, times out or
 * answers something that does not parse. A shopkeeper's order is never lost to a model outage.
 *
 * What it must cope with, taken from how Tarsun's shops actually write (docs/06 §13, docs/22 §4 R1):
 *
 *     "2 case campa 1L, 10 pc too yumm chilli"      English, mixed units, comma separated
 *     "do peti coca cola 750ml aur ek case lays"    Hinglish number words, "aur" as the separator
 *     "Bhai kal 5 case mom makhana bhej dena"       politeness, a day, a verb — all noise
 *     "campa 1l - 3 cs"                             quantity after the product, dash separated
 *
 * Three jobs, in order:
 *
 *   1. SPLIT the message into fragments on newlines, commas, semicolons, `+`, ` and `, ` aur `.
 *   2. READ each fragment for a quantity and a unit. Digits and number words (English and the
 *      Hinglish a shopkeeper types) both count; a number glued to a SIZE unit — `1L`, `750ml`, `90g`
 *      — is part of the product's name and is never mistaken for a quantity, which is the single
 *      most common way a naive parser gets "campa 1L" wrong.
 *   3. STRIP the noise (bhej, dena, chahiye, kal, bhai, please …) so what is left is the phrase the
 *      SKU matcher searches with.
 *
 * It deliberately does NOT match SKUs, touch the catalog or decide anything: it returns fragments,
 * and `matcher.ts` turns each phrase into candidate variants with a score. Nothing here is ever the
 * final word — every draft is confirmed by a human.
 */

export type EnteredUnit = 'piece' | 'inner' | 'case'

export interface ParsedFragment {
  /** The fragment exactly as written, so the review screen can show the shopkeeper's own words. */
  rawText: string
  /** What is left after the quantity, the unit and the noise are removed: what the matcher searches. */
  phrase: string
  /** The number the shopkeeper said. 1 when they said none ("campa 1L" means one of them). */
  qty: number
  unit: EnteredUnit
  /** False when no quantity word was found at all, so the reviewer knows 1 was assumed. */
  qtyStated: boolean
  /** False when no unit word was found; the matcher then reads the shop's habit, else pieces. */
  unitStated: boolean
}

/** Digits and the number words a Kalyan shopkeeper actually types, Devanagari transliterated. */
const NUMBER_WORDS: Readonly<Record<string, number>> = {
  // English
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  hundred: 100,
  dozen: 12,
  // Hinglish
  ek: 1,
  do: 2,
  teen: 3,
  tin: 3,
  char: 4,
  chaar: 4,
  panch: 5,
  paanch: 5,
  pach: 5,
  che: 6,
  chhe: 6,
  chah: 6,
  chhah: 6,
  saat: 7,
  sat: 7,
  aath: 8,
  ath: 8,
  nau: 9,
  das: 10,
  dus: 10,
  gyarah: 11,
  barah: 12,
  bara: 12,
  terah: 13,
  chaudah: 14,
  pandrah: 15,
  pandra: 15,
  solah: 16,
  satrah: 17,
  atharah: 18,
  unnis: 19,
  bees: 20,
  bis: 20,
  pachees: 25,
  pachis: 25,
  tees: 30,
  tis: 30,
  chalees: 40,
  chalis: 40,
  pachas: 50,
  pachaas: 50,
  sau: 100,
}

/** Words that name a SELLING unit. The value is the unit a `sales_order_lines.entered_unit` carries. */
const UNIT_WORDS: Readonly<Record<string, EnteredUnit>> = {
  case: 'case',
  cases: 'case',
  cs: 'case',
  cse: 'case',
  ctn: 'case',
  carton: 'case',
  cartons: 'case',
  peti: 'case',
  petti: 'case',
  pettti: 'case',
  box: 'case',
  boxes: 'case',
  bx: 'case',
  kes: 'case',
  inner: 'inner',
  inners: 'inner',
  dabba: 'inner',
  dabbe: 'inner',
  dabbi: 'inner',
  pc: 'piece',
  pcs: 'piece',
  piece: 'piece',
  pieces: 'piece',
  pis: 'piece',
  nag: 'piece',
  nug: 'piece',
  nos: 'piece',
  pouch: 'piece',
  pouches: 'piece',
  packet: 'piece',
  packets: 'piece',
  pkt: 'piece',
  pkts: 'piece',
  bottle: 'piece',
  bottles: 'piece',
  btl: 'piece',
  tin: 'piece',
  tins: 'piece',
  jar: 'piece',
  jars: 'piece',
  unit: 'piece',
  units: 'piece',
}

/**
 * Units of SIZE, not of sale. A number followed by one of these belongs to the product's name —
 * "campa 1 L", "too yumm 90 g" — and is never read as a quantity.
 */
const SIZE_UNITS: ReadonlySet<string> = new Set([
  'l',
  'lt',
  'ltr',
  'litre',
  'liter',
  'ml',
  'g',
  'gm',
  'gms',
  'gram',
  'grams',
  'kg',
  'kgs',
  'rs',
  'rupee',
  'rupees',
  'mrp',
  'inch',
  'cm',
])

/** Politeness, verbs, days and fillers: present in almost every message, meaningless to the matcher. */
const NOISE: ReadonlySet<string> = new Set([
  'bhej',
  'bhejo',
  'bhejna',
  'bhejdo',
  'bhejiye',
  'dena',
  'dedo',
  'dedena',
  'dijiye',
  'de',
  'do not',
  'chahiye',
  'chaiye',
  'chahiy',
  'karo',
  'kar',
  'kardo',
  'order',
  'orders',
  'kal',
  'aaj',
  'aj',
  'parso',
  'subah',
  'sham',
  'shaam',
  'morning',
  'evening',
  'today',
  'tomorrow',
  'please',
  'pls',
  'plz',
  'bhai',
  'bhaiya',
  'bhaisaab',
  'sir',
  'ji',
  'madam',
  'urgent',
  'jaldi',
  'ka',
  'ki',
  'ke',
  'ko',
  'se',
  'me',
  'mein',
  'need',
  'want',
  'send',
  'give',
  'want',
  'the',
  'a',
  'an',
  'of',
  'for',
  'my',
  'shop',
  'store',
  'hello',
  'hi',
  'namaste',
  'good',
  'thanks',
  'thank',
  'you',
  'ok',
  'okay',
  'and',
  'aur',
  'or',
  'bhi',
])

/** Splits a message into one fragment per intended line. */
export function splitFragments(text: string): string[] {
  return text
    .split(/\r?\n|[,;]|·|•|•|\s+\+\s+|\s+aur\s+|\s+and\s+|\s+&\s+/gi)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
}

/** Lowercase, punctuation to spaces, digits split off letters ("2case" → "2 case", "750ml" → "750 ml"). */
export function normaliseFragment(fragment: string): string[] {
  return fragment
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .split(/\s+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter((token) => token.length > 0)
}

function numberOf(token: string): number | null {
  if (/^\d{1,4}$/.test(token)) {
    const n = Number(token)
    return n > 0 ? n : null
  }
  return NUMBER_WORDS[token] ?? null
}

/**
 * Read one fragment. Returns null when nothing but noise is left — a "thanks bhai" line is not an
 * order line, and inventing one would put a phantom SKU in front of a reviewer.
 */
export function parseFragment(fragment: string): ParsedFragment | null {
  const tokens = normaliseFragment(fragment)
  if (tokens.length === 0) return null

  let qty: number | null = null
  let qtyIndex = -1
  let unit: EnteredUnit | null = null
  let unitIndex = -1

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as string
    const next = tokens[i + 1]
    if (qty === null) {
      const value = numberOf(token)
      // "1 l", "750 ml", "90 g": a size, not a count. Skip it and keep looking.
      if (value !== null && !(next !== undefined && SIZE_UNITS.has(next))) {
        qty = value
        qtyIndex = i
        continue
      }
    }
    if (unit === null && UNIT_WORDS[token] !== undefined) {
      // A unit word glued to a size ("500 ml bottle") still names the selling unit, so no guard here.
      unit = UNIT_WORDS[token]
      unitIndex = i
    }
  }

  const phrase = tokens
    .filter((token, i) => {
      if (i === qtyIndex || i === unitIndex) return false
      if (NOISE.has(token)) return false
      // A bare number that is part of the name ("1 l") stays; a stray one that is neither survives too.
      return true
    })
    .join(' ')
    .trim()
  if (phrase.length === 0) return null

  return {
    rawText: fragment.trim(),
    phrase,
    qty: qty ?? 1,
    unit: unit ?? 'piece',
    qtyStated: qty !== null,
    unitStated: unit !== null,
  }
}

/** Every readable line of a message, in the order it was written. */
export function parseMessage(text: string, maxLines: number): ParsedFragment[] {
  const out: ParsedFragment[] = []
  for (const fragment of splitFragments(text)) {
    const parsed = parseFragment(fragment)
    if (parsed) out.push(parsed)
    if (out.length >= maxLines) break
  }
  return out
}

/** Pieces from a quantity as entered, with the sell-side pack size (docs/17 A3, `packSizeFor`). */
export function piecesFor(qty: number, unit: EnteredUnit, caseSize: number | null): number {
  if (unit === 'piece') return qty
  const size = caseSize && caseSize > 0 ? caseSize : 0
  return size > 0 ? qty * size : 0
}
