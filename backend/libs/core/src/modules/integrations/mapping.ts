import type {
  ImportFieldKey,
  ImportMapping,
  ImportSource,
  ImportTarget,
  ImportTargetField,
} from '@dos/contracts'
import { IMPORT_TARGETS } from '@dos/contracts'
import { STATE_CODES } from '@dos/domain'
import { fieldsByKey, parseCell, parseUnitCell, type ParsedValue } from './fields.js'
import { BUILTIN_PROFILES } from './profiles.data.js'

/**
 * The mapping applied to a row (the middle of the wizard: map → dry run). Pure: no database, so the
 * scorer, the review handler and the specs share it.
 */

export interface RowProblem {
  field: ImportFieldKey | null
  message: string
}

export interface NormalizedRow {
  /** Target field → parsed value (paise, pieces, bps, ISO date, normalised code); absent when empty. */
  values: Record<string, ParsedValue>
  errors: RowProblem[]
  /** Every mapped cell was empty: a blank or a footer line, skipped rather than refused. */
  blank: boolean
}

/** A field a target does not have, a required field nobody mapped, or an `anyOf` group left empty. */
export function validateMappingForTarget(
  mapping: ImportMapping,
  target: ImportTarget,
): RowProblem[] {
  const spec = IMPORT_TARGETS[target]
  const known = fieldsByKey(target)
  const mapped = new Set<ImportFieldKey>()
  const problems: RowProblem[] = []
  for (const c of mapping.columns) {
    if (!known.has(c.field))
      problems.push({
        field: c.field,
        message: `${c.field} is not a field of ${spec.label}`,
      })
    mapped.add(c.field)
  }
  for (const c of mapping.constants) {
    if (!known.has(c.field))
      problems.push({
        field: c.field,
        message: `${c.field} is not a field of ${spec.label}`,
      })
    mapped.add(c.field)
  }
  for (const f of spec.fields) {
    if (f.required && !mapped.has(f.key))
      problems.push({
        field: f.key,
        message: `${f.label} must be mapped to a column or a fixed value`,
      })
  }
  for (const group of spec.anyOf) {
    if (!group.some((k) => mapped.has(k))) {
      const labels = group.map((k) => known.get(k)?.label ?? k).join(' or ')
      problems.push({ field: group[0] ?? null, message: `map at least one of: ${labels}` })
    }
  }
  return problems
}

// ---------------------------------------------------------------------------------------------------------------
// header → field suggestions

const simplify = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * Header words that mean a field, checked after the source's built-in profile. Order matters within a
 * target: the first pattern that matches wins, so the specific (`free qty`) sit above the general (`qty`).
 */
const HEURISTICS: readonly (readonly [RegExp, ImportFieldKey])[] = [
  [/^(party|outlet|customer|retailer|shop|ledger|account)\s*(code|id|no|number)$/, 'partyCode'],
  [
    /^(party|outlet|customer|retailer|shop|ledger|account)\s*name$|^(party|outlet|customer|retailer|shop)$/,
    'partyName',
  ],
  [/(owner|contact|proprietor)/, 'ownerName'],
  [/(mobile|phone|contact no|cell|whatsapp)/, 'phone'],
  [/buyer.*gst|outlet.*gst|party.*gst|customer.*gst/, 'buyerGstin'],
  [/gst.*(no|in|number|uin)|^gstin$|^gst$/, 'gstin'],
  [/^pan|pan\s*(no|number)/, 'pan'],
  [/address\s*(line)?\s*2|addr\s*2/, 'addressLine2'],
  [/address|addr|street/, 'addressLine1'],
  [/(area|locality|market|zone)/, 'area'],
  [/(city|town|station|district)/, 'city'],
  [/(pin|zip|postal)/, 'pincode'],
  [/place of supply|pos\b/, 'placeOfSupplyState'],
  [/state/, 'stateCode'],
  [/(beat|route)/, 'beatName'],
  [/(ledger|tally)/, 'tallyLedgerName'],
  [/(free|foc|scheme)\s*(qty|quantity|pcs|pieces)/, 'freeQty'],
  [/(item|sku|product|material)\s*(code|id|no|number)|^code$/, 'itemCode'],
  [/(item|sku|product|material|description|particulars)/, 'itemName'],
  [/(ean|barcode|upc|gtin)/, 'ean'],
  [/(brand|company|manufacturer)/, 'brandName'],
  [/hsn|sac/, 'hsnCode'],
  [/mrp|max.*retail/, 'mrp'],
  [/(case|carton|pack|ctn)\s*(size|qty|of|pcs|pieces)|pcs\s*(per|\/)\s*(case|ctn)/, 'caseSize'],
  [/gst\s*(%|rate|percent|slab)|tax\s*(%|rate)/, 'gstRate'],
  [/(alias|short|nick|display)\s*name|^alias$|^short$/, 'localAlias'],
  [/(invoice|bill|voucher|inv|ref)\s*(no|number|#|id)/, 'invoiceNo'],
  [/^due|due\s*(date|on)/, 'dueDate'],
  [/(expiry|exp|best before|use by)/, 'expiryDate'],
  [/(invoice|bill|voucher|inv|transaction)\s*(date|dt)|^date$/, 'invoiceDate'],
  [/(balance|outstanding|pending|due amount|amount due|closing|net amount|amount|total)/, 'amount'],
  [/(qty|quantity|pcs|pieces|nos)/, 'qty'],
  [/(unit|uom|per)/, 'unit'],
  [/(rate|price)/, 'rate'],
  [/(discount|disc|scheme amt)/, 'discount'],
  [/(batch|lot)/, 'batchNo'],
]

/** The field a header most likely means: the source's built-in profile first, then the words in the header. */
export function suggestField(
  header: string,
  source: ImportSource,
  target: ImportTarget,
): ImportFieldKey | null {
  const known = fieldsByKey(target)
  const wanted = simplify(header)
  if (!wanted) return null
  for (const profile of BUILTIN_PROFILES) {
    if (profile.source !== source || profile.target !== target) continue
    const hit = profile.mapping.columns.find((c) => simplify(c.column) === wanted)
    if (hit && known.has(hit.field)) return hit.field
  }
  for (const [re, field] of HEURISTICS) {
    if (known.has(field) && re.test(wanted)) return field
  }
  return null
}

// ---------------------------------------------------------------------------------------------------------------
// row normalisation

const STATE_BY_NAME = new Map(
  Object.entries(STATE_CODES).map(([code, name]) => [simplify(name), code]),
)
STATE_BY_NAME.set('mh', '27')
STATE_BY_NAME.set('gj', '24')
STATE_BY_NAME.set('ka', '29')
STATE_BY_NAME.set('dl', '07')
STATE_BY_NAME.set('up', '09')
STATE_BY_NAME.set('mp', '23')
STATE_BY_NAME.set('tn', '33')
STATE_BY_NAME.set('ap', '37')
STATE_BY_NAME.set('ts', '36')
STATE_BY_NAME.set('wb', '19')
STATE_BY_NAME.set('rj', '08')
STATE_BY_NAME.set('hr', '06')
STATE_BY_NAME.set('pb', '03')
STATE_BY_NAME.set('kl', '32')
STATE_BY_NAME.set('or', '21')
STATE_BY_NAME.set('od', '21')
STATE_BY_NAME.set('br', '10')
STATE_BY_NAME.set('jh', '20')
STATE_BY_NAME.set('cg', '22')
STATE_BY_NAME.set('ga', '30')
STATE_BY_NAME.set('uk', '05')
STATE_BY_NAME.set('as', '18')

/** `27`, `Maharashtra`, `MH`, `27-Maharashtra` → `27`; null when it is none of those. */
export function parseStateCell(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  const digits = /^(\d{1,2})\b/.exec(s)
  if (digits) {
    const code = (digits[1] ?? '').padStart(2, '0')
    return code in STATE_CODES ? code : null
  }
  return STATE_BY_NAME.get(simplify(s)) ?? null
}

const STATE_FIELDS = new Set<ImportFieldKey>(['stateCode', 'placeOfSupplyState'])
const POSITIVE_FIELDS = new Set<ImportFieldKey>(['qty'])
const NON_NEGATIVE_FIELDS = new Set<ImportFieldKey>([
  'freeQty',
  'rate',
  'discount',
  'mrp',
  'caseSize',
])

/**
 * One raw row through the mapping: constants first, columns over them, the reviewer's overrides over
 * both; each cell parsed by its field's type; then the target's own rules (required, positive
 * quantities, a state code that is a state). Errors name the column the operator sees.
 */
export function normalizeRow(
  raw: Readonly<Record<string, string>>,
  mapping: ImportMapping,
  target: ImportTarget,
  overrides: Readonly<Record<string, string>> | null = null,
): NormalizedRow {
  const spec = IMPORT_TARGETS[target]
  const known = fieldsByKey(target)
  const cells = new Map<ImportFieldKey, { text: string; column: string | null }>()
  for (const c of mapping.constants) cells.set(c.field, { text: c.value, column: null })
  let anyCell = false
  for (const c of mapping.columns) {
    const text = raw[c.column] ?? ''
    if (text.trim() !== '') anyCell = true
    cells.set(c.field, { text, column: c.column })
  }
  if (overrides) {
    for (const [field, text] of Object.entries(overrides)) {
      if (known.has(field as ImportFieldKey)) {
        cells.set(field as ImportFieldKey, { text, column: null })
        if (text.trim() !== '') anyCell = true
      }
    }
  }
  if (!anyCell) return { values: {}, errors: [], blank: true }

  const values: Record<string, ParsedValue> = {}
  const errors: RowProblem[] = []
  const label = (f: ImportTargetField, column: string | null): string =>
    column ? `"${column}"` : f.label
  for (const [key, cell] of cells) {
    const field = known.get(key)
    if (!field) continue
    const parsed = parseCell(cell.text, field, mapping)
    if (parsed.error) {
      errors.push({ field: key, message: `${label(field, cell.column)}: ${parsed.error}` })
      continue
    }
    let value = parsed.value
    if (value !== null && STATE_FIELDS.has(key)) {
      const code = parseStateCell(cell.text)
      if (!code) {
        errors.push({
          field: key,
          message: `${label(field, cell.column)}: "${cell.text.trim()}" is not a GST state code or a state name`,
        })
        continue
      }
      value = code
    }
    if (value !== null && key === 'unit') {
      const unit = parseUnitCell(cell.text)
      if (!unit) {
        errors.push({
          field: key,
          message: `${label(field, cell.column)}: "${cell.text.trim()}" is not piece, case or inner`,
        })
        continue
      }
      value = unit
    }
    if (value !== null) values[key] = value
  }
  for (const f of spec.fields) {
    if (!f.required || values[f.key] !== undefined) continue
    if (errors.some((e) => e.field === f.key)) continue
    const cell = cells.get(f.key)
    errors.push({
      field: f.key,
      message: cell?.column
        ? `"${cell.column}" is empty but ${f.label} is required`
        : `${f.label} is missing`,
    })
  }
  for (const group of spec.anyOf) {
    if (group.some((k) => values[k] !== undefined || errors.some((e) => e.field === k))) continue
    errors.push({
      field: group[0] ?? null,
      message: `one of ${group.map((k) => known.get(k)?.label ?? k).join(' / ')} is needed`,
    })
  }
  for (const key of POSITIVE_FIELDS) {
    const v = values[key]
    if (typeof v === 'number' && v <= 0)
      errors.push({ field: key, message: `${known.get(key)?.label ?? key} must be more than zero` })
  }
  for (const key of NON_NEGATIVE_FIELDS) {
    const v = values[key]
    if (typeof v === 'number' && v < 0)
      errors.push({ field: key, message: `${known.get(key)?.label ?? key} cannot be negative` })
  }
  if (target === 'opening_outstanding' && typeof values.amount === 'number' && values.amount <= 0)
    errors.push({
      field: 'amount',
      message:
        'the outstanding amount must be more than zero; a credit balance is recorded as a receipt on account, not as a bill',
    })
  if (typeof values.gstRate === 'number' && values.gstRate > 5000)
    errors.push({ field: 'gstRate', message: 'GST rate above 50% cannot be right' })
  return { values, errors, blank: false }
}

/** The pieces a quantity means once the unit and the pack size are known (`case` × pack, `inner` × inner size when known). */
export function quantityInPieces(
  qty: number,
  unit: string | null | undefined,
  packSize: number | null,
  innerSize: number | null = null,
): number | null {
  if (!unit || unit === 'piece') return qty
  if (unit === 'case') return packSize ? qty * packSize : null
  if (unit === 'inner') return innerSize ? qty * innerSize : packSize ? qty * packSize : null
  return null
}
