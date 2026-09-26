/**
 * A flat sheet as a list of records, keyed by the header text.
 *
 * The legacy software's report headers are its own (`ITEM_CODE`, `SAL_AMT`); the importer is bound to
 * those names on purpose — this is the ONE source the founder handed over — but it fails loudly, naming
 * the missing COLUMNS (never a cell), when a re-export renames one, instead of importing half a sheet.
 */
export class LegacyFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LegacyFormatError'
  }
}

export interface SheetRecord {
  /** 1-based row number in the sheet (the header is row 1), for issue references. */
  row: number
  cells: ReadonlyMap<string, string>
}

export function sheetRecords(
  rows: readonly (readonly string[])[],
  required: readonly string[],
  what: string,
): SheetRecord[] {
  const header = rows[0]
  if (!header) throw new LegacyFormatError(`${what}: the sheet is empty`)
  const index = new Map<string, number>()
  header.forEach((h, i) => {
    const key = h.trim().toUpperCase()
    if (key !== '' && !index.has(key)) index.set(key, i)
  })
  const missing = required.filter((c) => !index.has(c.toUpperCase()))
  if (missing.length > 0)
    throw new LegacyFormatError(`${what}: missing column(s) ${missing.join(', ')}`)
  const out: SheetRecord[] = []
  rows.slice(1).forEach((r, i) => {
    if (r.every((c) => c.trim() === '')) return
    const cells = new Map<string, string>()
    for (const [key, at] of index) cells.set(key, (r[at] ?? '').trim())
    out.push({ row: i + 2, cells })
  })
  return out
}

export const cell = (r: SheetRecord, column: string): string =>
  r.cells.get(column.toUpperCase()) ?? ''
