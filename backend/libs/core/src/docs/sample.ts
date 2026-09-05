/**
 * Builds realistic example values from Zod 4 schemas for the generated READMEs. Reads the schema's
 * internal definition (`_zod.def`) — the same source the OpenAPI generator uses — plus field-name heuristics
 * so a `ratePaise` shows 4000 and a `phone` shows a valid Indian mobile, not "string".
 */
type Def = {
  type: string
  shape?: Record<string, ZodLike>
  innerType?: ZodLike
  element?: ZodLike
  options?: ZodLike[]
  entries?: Record<string, string | number>
  values?: unknown[]
  format?: string
  defaultValue?: unknown
  checks?: {
    _zod: {
      def: {
        check: string
        format?: string
        minimum?: number
        maximum?: number
        inclusive?: boolean
        value?: number
        pattern?: RegExp
      }
    }
  }[]
  in?: ZodLike
  out?: ZodLike
  keyType?: ZodLike
  valueType?: ZodLike
}
export type ZodLike = { _zod: { def: Def } }

import { createHash } from 'node:crypto'

/** Deterministic, well-formed UUIDv7-shaped id per field name, so the same field shows the same id across examples. */
function sampleUuid(key: string): string {
  const h = createHash('sha1').update(`readme:${key}`).digest('hex')
  return `01a06d${h.slice(0, 2)}-${h.slice(2, 6)}-7${h.slice(6, 9)}-8${h.slice(9, 12)}-${h.slice(12, 24)}`
}

/**
 * Illustrative only — never a real signed token. Shown as the sample `Authorization: Bearer` value on
 * every non-public endpoint in the generated READMEs (readme.ts), and as the `accessToken` field of
 * every auth response.
 */
export const SAMPLE_ACCESS_TOKEN =
  'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIwMWEwNmQ4Zi04NzY1LTc0MzItODAwOS1hYmNkZWYwMTIzNDUi…'

/** Illustrative only — a real refresh token is random; this just has the right shape (opaque, base64url, 43 chars). */
export const SAMPLE_REFRESH_TOKEN = 'dvRVefW6iYMCcmo4hNcsaPfXvmANyxisdZd75S-F7Gk'

const NAME_HINTS: [RegExp, unknown][] = [
  [/^idempotencyKey$/, 'a3d7c1e2-…-one-key-per-tap'],
  // DATES AND TIMES COME FIRST. These two used to sit at the bottom, which meant a field whose name
  // merely CONTAINED a word from a broader rule was sampled as that instead: billing's `noteDate`
  // matched the free-text `note` rule and the example came out as a sentence where the contract wants
  // `YYYY-MM-DD`. A name ending in `Date`/`At` is a date whatever else it contains, so it is decided here.
  [/Date$|^date$|^on$|^from$|^to$|validFrom|validTo|^day$|payBy|asOf/i, '2026-09-04'],
  [/At$/, '2026-09-04T10:30:00.000Z'],
  // A 12-digit e-way bill number, keyed in from the government portal. Before the generic `No$` rule.
  // Two spellings are in the contracts: billing's `ewayBillNo` and warehouse's `ewbNo`, which is named
  // for the `ewb_no` column the load sheet and the challan both carry.
  [/ewayBillNo$|ewbNo$/i, '291012345678'],
  [/username$/i, 'sunil.tarsun'],
  [/password$/i, 'Dos@1234'],
  [/^accessToken$/, SAMPLE_ACCESS_TOKEN],
  [/^refreshToken$/, SAMPLE_REFRESH_TOKEN],
  [/phone$/i, '+919876543210'],
  [/gstin$/i, '27AAPFU0939F1ZV'],
  [/pan$/i, 'AAPFU0939F'],
  [/hsnCode$/i, '22021010'],
  [/stateCode$/i, '27'],
  [/pincode$/i, '421301'],
  [/^(q|search)$/, 'campa'],
  [/limit$/i, 50],
  [/(lat)$/i, 19.2403],
  [/(lng|lon)$/i, 73.1305],
  [/Bps$/, 500],
  [/(total|subtotal|gross|net|outstanding|creditLimit)Paise$/i, 2680000],
  [/(discount|tax|cgst|sgst|igst|cess|roundOff)Paise$/i, 12000],
  [/(mrp|rate|price|cost|amount|asked|approved|list)\w*Paise$/i, 4000],
  [/Paise$/, 4000],
  [/(qty|pcs|pieces|quantity)/i, 24],
  [/caseSize|packSize|pcsPerCase/i, 24],
  [/lineNo|sequence|priority|version/i, 1],
  [/days$/i, 7],
  [/^name$/i, 'Sharma Kirana Store'],
  // The importer's column names are header text as the file wrote it, not a code.
  [/^(column|header)$/i, 'Party Name'],
  [/(shop|legal|product|variant|brand|manufacturer|supplier|beat|list)Name$/i, 'Campa Cola 750 ml'],
  [/ownerName/i, 'Ramesh Sharma'],
  [/note|reason|message|description|narration/i, 'Confirmed on phone with the shopkeeper'],
  [/code$/i, 'R-0001'],
  [/No$/, 'SO-0042'],
  [/email/i, 'owner@tarsun.example'],
  [/url|objectKey/i, 'docs/2026/09/invoice-0042.jpg'],
  // deviceId has no hint of its own: it ends in "Id" so the generic UUID rule below fires, and every
  // deviceId field (login, sessions, sync, orders) shows the SAME uuid — matching the real app, which
  // generates one device id per install and reuses it everywhere.
  [/^source$/i, 'salesperson'],
  [/externalRef|externalInvoiceNo/i, 'FA-2026-000123'],
  [/flags$/i, 'credit_limit'],
  [/rewardKind/i, 'free_qty'],
  [/^kind$/i, 'credit_limit'],
  [/^event$/i, 'submit'],
  [/status$/i, 'pending'],
  [/gstBps/i, 1800],
  [/cessBps/i, 0],
  [/free/i, 2],
  [/opId/i, 'op-000123'],
  [/table$/i, 'sales_orders'],
  [/locale|lang/i, 'hi-IN'],
  [/fy$/i, '2026-27'],
]

function byName(key: string): unknown {
  for (const [re, value] of NAME_HINTS) if (re.test(key)) return value
  return undefined
}

function stringSample(def: Def, key: string): unknown {
  const named = byName(key)
  if (def.format === 'uuid') return sampleUuid(key)
  if (named !== undefined && typeof named === 'string') return named
  if (/Id$|^id$/.test(key)) return sampleUuid(key)
  if (def.format === 'date') return '2026-09-04'
  if (def.format === 'datetime') return '2026-09-04T10:30:00.000Z'
  const regex = def.checks?.find((c) => c._zod.def.format === 'regex')?._zod.def.pattern
  if (regex) {
    const s = String(regex)
    if (s.includes('+91')) return '+919876543210'
    if (s.includes('[0-9]{2}[A-Z]{5}')) return '27AAPFU0939F1ZV'
    if (s.includes('\\d{4,8}')) return '22021010'
    if (s.includes('\\d{2}')) return '27'
    if (s.includes('\\d{8,14}')) return '8901234567890'
  }
  return 'text'
}

function numberSample(def: Def, key: string): number {
  const named = byName(key)
  const min = def.checks?.find((c) => c._zod.def.check === 'greater_than')?._zod.def.value
  const max = def.checks?.find((c) => c._zod.def.check === 'less_than')?._zod.def.value
  let n = typeof named === 'number' ? named : 1
  if (min !== undefined && n < min) n = min
  if (max !== undefined && n > max) n = max
  return n
}

export function sample(schema: ZodLike, key = '', depth = 0): unknown {
  const def = schema._zod.def
  if (depth > 8) return null
  switch (def.type) {
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const [k, child] of Object.entries(def.shape ?? {})) {
        if (k === 'cursor' || k === 'nextCursor') {
          if (k === 'nextCursor') out[k] = null
          continue
        }
        const v = sample(child, k, depth + 1)
        if (v !== undefined) out[k] = v
      }
      return out
    }
    case 'array':
      return [sample(def.element as ZodLike, key.replace(/s$/, ''), depth + 1)]
    case 'optional': {
      // keep optional fields visible in examples unless they are pagination plumbing
      return sample(def.innerType as ZodLike, key, depth + 1)
    }
    case 'nullable':
      // "not happened yet" fields read better as null in a fresh example
      if (
        /(cancelled|decided|resolved|deleted|closed|ended|withdrawn|revoked|realised|settled)/i.test(
          key,
        ) ||
        /Reason$|^note$|mergedInto|externalRef/i.test(key)
      )
        return null
      return sample(def.innerType as ZodLike, key, depth + 1)
    case 'default':
      return def.defaultValue !== undefined && typeof def.defaultValue !== 'function'
        ? def.defaultValue
        : sample(def.innerType as ZodLike, key, depth + 1)
    case 'union':
      return sample((def.options ?? [])[0] as ZodLike, key, depth + 1)
    case 'pipe':
      return sample((def.out ?? def.in) as ZodLike, key, depth + 1)
    case 'enum': {
      const values = Object.values(def.entries ?? {})
      return values[0]
    }
    case 'literal':
      return def.values?.[0]
    case 'string':
      return stringSample(def, key)
    case 'number':
      return numberSample(def, key)
    case 'boolean':
      return true
    case 'record':
      return { line1: '12 Station Road', city: 'Kalyan West', pincode: '421301' }
    case 'unknown':
    case 'any':
      return { example: true }
    case 'null':
      return null
    default:
      return null
  }
}

/** Distinguishes required from optional keys of an object schema (for the request field table). */
export function fields(schema: ZodLike): { key: string; required: boolean; type: string }[] {
  const def = schema._zod.def
  const inner = def.type === 'pipe' ? (def.in as ZodLike)._zod.def : def
  if (inner.type !== 'object') return []
  return Object.entries(inner.shape ?? {}).map(([key, child]) => {
    let d = child._zod.def
    let required = true
    while (d.type === 'optional' || d.type === 'default' || d.type === 'nullable') {
      if (d.type !== 'nullable') required = false
      d = (d.innerType as ZodLike)._zod.def
    }
    return { key, required, type: describeType(d) }
  })
}

function describeType(d: Def): string {
  switch (d.type) {
    case 'enum':
      return Object.values(d.entries ?? {}).join(' | ')
    case 'array':
      return `${describeType((d.element as ZodLike)._zod.def)}[]`
    case 'string':
      return d.format === 'uuid' ? 'uuid' : (d.format ?? 'string')
    case 'number':
      return d.checks?.some((c) => c._zod.def.format === 'safeint') ? 'integer' : 'number'
    case 'pipe':
      return describeType((d.in as ZodLike)._zod.def)
    case 'union':
      return (d.options ?? []).map((o) => describeType(o._zod.def)).join(' | ')
    default:
      return d.type
  }
}
