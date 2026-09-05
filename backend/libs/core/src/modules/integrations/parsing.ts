import { MAX_IMPORT_ROWS } from '@dos/contracts'
import { looksLikeXlsx, parseCsv, readXlsx, XlsxError } from './xlsx.js'

/**
 * From bytes to rows: the one step of the wizard that touches the file. CSV or XLSX is decided from the
 * bytes (a zip signature means XLSX), never from the name a browser gave the upload. Every cell is a
 * string exactly as written; the mapping decides what it means later.
 */

export interface ParsedSource {
  /** Column headers in file order — the first row when `hasHeaderRow`, else `col_1 … col_N`. */
  headers: string[]
  /** One record per data row, cells keyed by header (missing cells are `''`). */
  rows: Record<string, string>[]
  /** Every sheet of an XLSX; `[]` for a CSV. */
  sheetNames: string[]
}

/** A file the stage job refuses: the message is stored on the job as its English `error`. */
export class SourceFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SourceFileError'
  }
}

/** Headers made unique and non-empty: a blank header becomes `col_N`, a repeat becomes `Name (2)`. */
export function uniqueHeaders(raw: readonly string[]): string[] {
  const seen = new Map<string, number>()
  return raw.map((h, i) => {
    const base = (h ?? '').trim().replace(/\s+/g, ' ').slice(0, 120) || `col_${String(i + 1)}`
    const count = (seen.get(base.toLowerCase()) ?? 0) + 1
    seen.set(base.toLowerCase(), count)
    return count === 1 ? base : `${base} (${String(count)})`
  })
}

export function parseSource(
  bytes: Buffer,
  opts: { hasHeaderRow: boolean; sheetName: string | null },
): ParsedSource {
  let table: string[][]
  let sheetNames: string[] = []
  if (looksLikeXlsx(bytes)) {
    let workbook
    try {
      workbook = readXlsx(bytes)
    } catch (error) {
      throw new SourceFileError(
        error instanceof XlsxError ? error.message : 'the workbook could not be read',
      )
    }
    sheetNames = workbook.sheetNames
    const sheet = workbook.sheet(opts.sheetName ?? undefined)
    if (!sheet)
      throw new SourceFileError(
        `sheet '${opts.sheetName ?? ''}' was not found; the workbook has: ${sheetNames.join(', ')}`,
      )
    table = sheet.rows
  } else {
    const text = bytes.toString('utf8')
    if (text.includes('\0'))
      throw new SourceFileError('the file is neither a CSV nor an XLSX workbook')
    table = parseCsv(text)
  }
  // Leading blank lines (a report title block) are skipped up to the first non-empty row.
  while (table.length > 0 && (table[0] ?? []).every((c) => c.trim() === '')) table.shift()
  if (table.length === 0) throw new SourceFileError('the file has no rows')
  const width = Math.max(...table.map((r) => r.length))
  const headers = uniqueHeaders(
    opts.hasHeaderRow
      ? padded(table[0] ?? [], width)
      : Array.from({ length: width }, (_, i) => `col_${String(i + 1)}`),
  )
  const body = opts.hasHeaderRow ? table.slice(1) : table
  if (body.length > MAX_IMPORT_ROWS)
    throw new SourceFileError(
      `the file has ${String(body.length)} rows; the limit is ${String(MAX_IMPORT_ROWS)} — split the file`,
    )
  const rows = body.map((cells) => {
    const record: Record<string, string> = {}
    headers.forEach((h, i) => {
      record[h] = (cells[i] ?? '').trim()
    })
    return record
  })
  return { headers, rows, sheetNames }
}

function padded(row: readonly string[], width: number): string[] {
  const out = [...row]
  while (out.length < width) out.push('')
  return out
}
