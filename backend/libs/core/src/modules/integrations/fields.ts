import type {
  ImportDateFormat,
  ImportFieldKey,
  ImportFieldType,
  ImportMapping,
  ImportTarget,
  ImportTargetField,
} from '@dos/contracts'
import { IMPORT_TARGETS } from '@dos/contracts'
import { isValidGstin } from '@dos/domain'

/**
 * How a cell becomes a value (contract: "money is integer paise ... quantities integer pieces ...
 * percentages basis points, dates IST (a garbled date is a ROW error, never a job failure)"). Pure
 * functions over strings: the same code scores a staged row, a hand-corrected cell and a spec fixture.
 * Every refusal is a short English sentence that names what was read, never a parser's exception.
 */

export type ParsedValue = string | number | null

export interface ParseOutcome {
  value: ParsedValue
  error: string | null
}

const ok = (value: ParsedValue): ParseOutcome => ({ value, error: null })
const bad = (error: string): ParseOutcome => ({ value: null, error })

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  sept: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}

function isoIfValid(y: number, m: number, d: number): string | null {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const at = new Date(Date.UTC(y, m - 1, d))
  if (at.getUTCFullYear() !== y || at.getUTCMonth() !== m - 1 || at.getUTCDate() !== d) return null
  return at.toISOString().slice(0, 10)
}

/** Two-digit years are read as 20xx: a 1990s bill has no business in a migration file. */
const year = (s: string): number => (s.length === 2 ? 2000 + Number(s) : Number(s))

/** `YYYY-MM-DD`, `DD-MM-YYYY`, `DD/MM/YYYY`, `MM/DD/YYYY`, `DD-MMM-YYYY` (and `DD.MM.YYYY`, `YYYY/MM/DD`, a trailing time) → ISO, or null. */
export function parseDateCell(raw: string, format: ImportDateFormat): string | null {
  const s = raw.trim().replace(/[T ]\d{1,2}:\d{2}(:\d{2})?.*$/, '')
  if (!s) return null
  const iso = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  const dmy = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(s)
  const dMonY = /^(\d{1,2})[-/. ]([A-Za-z]{3,4})[-/. ](\d{2}|\d{4})$/.exec(s)
  switch (format) {
    case 'YYYY-MM-DD':
      return iso ? isoIfValid(Number(iso[1]), Number(iso[2]), Number(iso[3])) : null
    case 'DD-MM-YYYY':
    case 'DD/MM/YYYY':
      return dmy ? isoIfValid(year(dmy[3] ?? ''), Number(dmy[2]), Number(dmy[1])) : null
    case 'MM/DD/YYYY':
      return dmy ? isoIfValid(year(dmy[3] ?? ''), Number(dmy[1]), Number(dmy[2])) : null
    case 'DD-MMM-YYYY': {
      if (!dMonY) return null
      const month = MONTHS[(dMonY[2] ?? '').toLowerCase()]
      return month ? isoIfValid(year(dMonY[3] ?? ''), month, Number(dMonY[1])) : null
    }
    case 'auto': {
      if (iso) return isoIfValid(Number(iso[1]), Number(iso[2]), Number(iso[3]))
      if (dMonY) {
        const month = MONTHS[(dMonY[2] ?? '').toLowerCase()]
        return month ? isoIfValid(year(dMonY[3] ?? ''), month, Number(dMonY[1])) : null
      }
      // Day first, the Indian reading; `MM/DD/YYYY` must be chosen on purpose.
      if (dmy) return isoIfValid(year(dmy[3] ?? ''), Number(dmy[2]), Number(dmy[1]))
      // An Excel serial that reached us as a bare number (a CSV saved from a date column).
      if (/^\d{5}$/.test(s)) {
        const serial = Number(s)
        if (serial > 32_000 && serial < 60_000)
          return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000).toISOString().slice(0, 10)
      }
      return null
    }
  }
}

/** `₹1,23,456.50`, `1234.5`, `(250)`, `250-`, `250 Dr` → paise (rupees) or the integer itself (paise); null when unreadable. */
export function parseAmountCell(raw: string, unit: ImportMapping['amountUnit']): number | null {
  let s = raw
    .trim()
    .replace(/^(rs\.?|inr|₹)\s*/i, '')
    .replace(/\s*(rs\.?|inr|₹)$/i, '')
    .replace(/,/g, '')
    .replace(/\s+/g, '')
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  if (/-$/.test(s)) {
    negative = true
    s = s.slice(0, -1)
  }
  if (/(cr|dr)$/i.test(s)) {
    if (/cr$/i.test(s)) negative = !negative
    s = s.replace(/(cr|dr)$/i, '')
  }
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  }
  if (s.startsWith('+')) s = s.slice(1)
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) return null
  const whole = m[1] ?? '0'
  const fraction = m[2] ?? ''
  let paise: number
  if (unit === 'paise') {
    if (fraction && Number(fraction) !== 0) return null
    paise = Number(whole)
  } else {
    // Rupees → paise without going through a float: the fraction is read as two digits, half-up.
    const frac2 = (fraction + '000').slice(0, 3)
    let cents = Number(frac2.slice(0, 2))
    if (Number(frac2[2]) >= 5) cents += 1
    paise = Number(whole) * 100 + cents
  }
  if (!Number.isSafeInteger(paise)) return null
  return negative ? -paise : paise
}

/** Digits only; `+91`, `91` and a leading `0` are stripped; must be ten digits starting 6–9. */
export function parsePhoneCell(raw: string): string | null {
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  if (digits.length !== 10 || !/^[6-9]/.test(digits)) return null
  return `+91${digits}`
}

export function parseIntegerCell(raw: string): number | null {
  const s = raw.trim().replace(/,/g, '')
  if (!s) return null
  const m = /^([+-]?\d+)(?:\.0+)?$/.exec(s)
  if (!m) return null
  const n = Number(m[1])
  return Number.isSafeInteger(n) ? n : null
}

/** `18`, `18%`, `18.00 %` → basis points (1800). */
export function parsePercentCell(raw: string): number | null {
  const s = raw.trim().replace(/%/g, '').replace(/\s+/g, '')
  if (!s) return null
  const m = /^(\d+)(?:\.(\d+))?$/.exec(s)
  if (!m) return null
  const frac2 = ((m[2] ?? '') + '00').slice(0, 2)
  const bps = Number(m[1]) * 100 + Number(frac2)
  return bps > 100_00 ? null : bps
}

export function parseGstinCell(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/\s+/g, '')
  if (!s) return null
  return isValidGstin(s) ? s : null
}

/** The quantity unit a register or a DMS export names, normalised to the three the sell side knows. */
export function parseUnitCell(raw: string): 'piece' | 'case' | 'inner' | null {
  const s = raw.trim().toLowerCase().replace(/[.\s]/g, '')
  if (!s) return null
  if (
    [
      'pc',
      'pcs',
      'piece',
      'pieces',
      'nos',
      'no',
      'unit',
      'units',
      'each',
      'ea',
      'pkt',
      'pkts',
    ].includes(s)
  )
    return 'piece'
  if (
    ['cs', 'case', 'cases', 'ctn', 'carton', 'cartons', 'box', 'boxes', 'bag', 'bags'].includes(s)
  )
    return 'case'
  if (['inner', 'inners', 'in', 'dz', 'doz', 'dozen'].includes(s)) return 'inner'
  return null
}

/** Reads one cell for one target field; an empty cell is `null`, never an error (required-ness is checked by the row). */
export function parseCell(
  raw: string,
  field: ImportTargetField,
  mapping: Pick<ImportMapping, 'dateFormat' | 'amountUnit'>,
): ParseOutcome {
  const text = raw.trim()
  if (text === '') return ok(null)
  switch (field.type) {
    case 'text':
      return ok(text.replace(/\s+/g, ' ').slice(0, 200))
    case 'code':
      return ok(text.replace(/\s+/g, ' ').slice(0, 64))
    case 'phone': {
      const phone = parsePhoneCell(text)
      return phone ? ok(phone) : bad(`"${text}" is not an Indian mobile number`)
    }
    case 'gstin': {
      const gstin = parseGstinCell(text)
      return gstin ? ok(gstin) : bad(`"${text}" is not a valid GSTIN`)
    }
    case 'date': {
      const date = parseDateCell(text, mapping.dateFormat)
      return date
        ? ok(date)
        : bad(
            `"${text}" is not a date${mapping.dateFormat === 'auto' ? '' : ` in the format ${mapping.dateFormat}`}`,
          )
    }
    case 'amount': {
      const paise = parseAmountCell(text, mapping.amountUnit)
      return paise === null ? bad(`"${text}" is not an amount`) : ok(paise)
    }
    case 'integer': {
      const n = parseIntegerCell(text)
      return n === null ? bad(`"${text}" is not a whole number`) : ok(n)
    }
    case 'percent': {
      const bps = parsePercentCell(text)
      return bps === null ? bad(`"${text}" is not a percentage`) : ok(bps)
    }
  }
}

/** `IMPORT_TARGETS[target].fields` keyed by field for O(1) lookups while scoring. */
export function fieldsByKey(target: ImportTarget): ReadonlyMap<ImportFieldKey, ImportTargetField> {
  return new Map(IMPORT_TARGETS[target].fields.map((f) => [f.key, f]))
}

/** The type a field has under a target (the same key may be `code` on one target and `text` on another). */
export function fieldType(target: ImportTarget, key: ImportFieldKey): ImportFieldType | null {
  return fieldsByKey(target).get(key)?.type ?? null
}
