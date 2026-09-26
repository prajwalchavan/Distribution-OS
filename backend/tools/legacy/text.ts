/**
 * Small, pure normalisers shared by every legacy parser. None of them ever sees more than one cell.
 */

const IRREGULAR_SPACES = new RegExp('[\\u00a0\\u2007\\u202f]', 'g')

/** Collapse runs of whitespace (a no-break space included), trim. Anything that is not text or a number is ''. */
export function clean(raw: unknown): string {
  const text = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : ''
  return text.replace(IRREGULAR_SPACES, ' ').replace(/\s+/g, ' ').trim()
}

/** Upper-cased letters and digits only: two spellings of one name that differ in punctuation or spacing collide. */
export function nameKey(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * The GST rupee amounts of a legacy sheet arrive as the text the file wrote (`4.16`, `1,234.50`, `247.619`).
 * Rupees to integer paise WITHOUT a float: the fraction is read as decimal digits, half-up on the third.
 * `null` when the cell is empty or is not a plain non-negative decimal.
 */
export function rupeesToPaise(raw: string | null | undefined): number | null {
  const s = clean(raw).replace(/,/g, '')
  if (s === '') return null
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) return null
  const whole = Number(m[1])
  const frac = (m[2] ?? '').padEnd(3, '0')
  let paise = whole * 100 + Number(frac.slice(0, 2))
  if (Number(frac[2]) >= 5) paise += 1
  return Number.isSafeInteger(paise) ? paise : null
}

/** A signed variant (an amount that may be a credit): `null` when unparseable. */
export function signedRupeesToPaise(raw: string | null | undefined): number | null {
  const s = clean(raw)
  if (s.startsWith('-')) {
    const n = rupeesToPaise(s.slice(1))
    return n === null ? null : -n
  }
  return rupeesToPaise(s)
}

/** `18`, `5.00`, `2.5` → basis points. `null` when not a percentage between 0 and 100. */
export function percentToBps(raw: string | null | undefined): number | null {
  const s = clean(raw).replace(/%/g, '')
  if (s === '') return null
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) return null
  const bps = Number(m[1]) * 100 + Number(((m[2] ?? '') + '00').slice(0, 2))
  return bps <= 10_000 ? bps : null
}

/** Digits only; `+91`, `91` and a leading `0` are stripped; ten digits starting 6-9, else `null` (the app's own rule). */
export function parseIndianMobile(raw: string | null | undefined): string | null {
  let digits = clean(raw).replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length !== 10 || !/^[6-9]/.test(digits)) return null
  return `+91${digits}`
}

export interface NormalisedHsn {
  hsn: string
  /** A leading zero was restored: the spreadsheet had stored the code as a number and dropped it. */
  padded: boolean
}

/**
 * An HSN code as the app stores it: text of 4, 6 or 8 digits. Spreadsheets keep it as a number, which drops a
 * leading zero (`08135020` → `8135020`, `08013100` → `8013100`), so an odd length is left-padded with one zero.
 * `null` when the cell is empty or is not a 4-8 digit code.
 */
export function normaliseHsn(raw: string | null | undefined): NormalisedHsn | null {
  const digits = clean(raw).replace(/\D/g, '')
  if (digits === '') return null
  const padded = digits.length % 2 === 1
  const hsn = padded ? `0${digits}` : digits
  return /^\d{4,8}$/.test(hsn) ? { hsn, padded } : null
}

/** `27 - Maharashtra` → `27`; the GSTIN's own first two digits are the better source and are tried first by callers. */
export function stateCodeFromLabel(raw: string | null | undefined): string | null {
  const m = /^\s*(\d{1,2})\b/.exec(clean(raw))
  if (!m) return null
  return validStateCode(m[1] ?? '')
}

/** GST state codes 01-38 (98 "Other Territory" and 97 are not places a shop sits in, and are refused). */
export function validStateCode(code: string): string | null {
  const padded = code.padStart(2, '0')
  const n = Number(padded)
  return /^\d{2}$/.test(padded) && n >= 1 && n <= 38 ? padded : null
}

/** An ISO date (`2026-06-04`) from what a sheet gives: `2026-06-04`, `2026-06-04T00:00:00`, `04/06/2026`. */
export function isoDate(raw: string | null | undefined): string | null {
  const s = clean(raw)
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s)
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(s)
  let y: number, m: number, d: number
  if (iso) [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])]
  else if (dmy) [y, m, d] = [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])]
  else return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d)
    return null
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/** Days from `a` to `b` (both ISO dates). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** The next calendar day of an ISO date. */
export function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

/** Group `values` by `key`; the order of first appearance is kept. */
export function groupBy<T>(values: readonly T[], key: (v: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const v of values) {
    const k = key(v)
    const list = out.get(k)
    if (list) list.push(v)
    else out.set(k, [v])
  }
  return out
}
